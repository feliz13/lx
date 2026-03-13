package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"context"

	"github.com/gorilla/websocket"

	"lx-relay/internal/config"
	"lx-relay/internal/crypto"
	"lx-relay/internal/lanxin"
	"lx-relay/protocol"
)

var (
	configPath = flag.String("config", envOr("LX_RELAY_CONFIG", "config.json"), "Path to config file")
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// ── Event parsing ───────────────────────────────────────────────────────

type callbackPayload struct {
	AppId  string          `json:"appId"`
	OrgId  string          `json:"orgId"`
	Events []callbackEvent `json:"events"`
}

type callbackEvent struct {
	ID        string    `json:"id"`
	EventType string    `json:"eventType"`
	Data      eventData `json:"data"`
}

type eventData struct {
	From    string          `json:"from"`
	GroupId string          `json:"groupId"`
	EntryId string          `json:"entryId"`
	MsgType string          `json:"msgType"`
	MsgData json.RawMessage `json:"msgData"`
}

type routeResult struct {
	eventType string // "bot_private_message" or "bot_group_message"
	routeKey  string // the openId to look up (from or groupId)
	from      string // sender
	groupId   string // group ID (empty for private)
	account   *config.AccountConfig
}

// ── Client connection ───────────────────────────────────────────────────

type clientConn struct {
	conn    *websocket.Conn
	writeMu sync.Mutex
	done    chan struct{}
	openIds []string
}

func (c *clientConn) writeJSON(v any) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.WriteJSON(v)
}

// ── Relay server ────────────────────────────────────────────────────────

type relay struct {
	cfg *config.ServerConfig

	mu      sync.RWMutex
	clients map[*clientConn]struct{}
	idIndex map[string]*clientConn // openId → client

	pendingMu sync.Mutex
	pending   map[string]chan protocol.Message
}

func newRelay(cfg *config.ServerConfig) *relay {
	return &relay{
		cfg:     cfg,
		clients: make(map[*clientConn]struct{}),
		idIndex: make(map[string]*clientConn),
		pending: make(map[string]chan protocol.Message),
	}
}

func (r *relay) registerClient(c *clientConn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.clients[c] = struct{}{}
	for _, id := range c.openIds {
		if old, exists := r.idIndex[id]; exists && old != c {
			log.Printf("[ws] openId %q re-registered from %s to %s", id, old.conn.RemoteAddr(), c.conn.RemoteAddr())
		}
		r.idIndex[id] = c
	}
	log.Printf("[ws] registered client %s with openIds=%v (total clients=%d)", c.conn.RemoteAddr(), c.openIds, len(r.clients))
}

func (r *relay) unregisterClient(c *clientConn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.clients, c)
	for _, id := range c.openIds {
		if r.idIndex[id] == c {
			delete(r.idIndex, id)
		}
	}
	log.Printf("[ws] unregistered client %s (total clients=%d)", c.conn.RemoteAddr(), len(r.clients))
}

func (r *relay) findClient(openId string) *clientConn {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.idIndex[openId]
}

// ── WebSocket handler ───────────────────────────────────────────────────

func (r *relay) handleWS(w http.ResponseWriter, req *http.Request) {
	conn, err := upgrader.Upgrade(w, req, nil)
	if err != nil {
		log.Printf("[ws] upgrade error: %v", err)
		return
	}
	log.Printf("[ws] client connected from %s", conn.RemoteAddr())

	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	var authMsg protocol.Message
	if err := conn.ReadJSON(&authMsg); err != nil {
		log.Printf("[ws] auth read error: %v", err)
		conn.Close()
		return
	}
	if authMsg.Type != protocol.MsgTypeAuth || authMsg.Secret != r.cfg.Secret {
		_ = conn.WriteJSON(protocol.Message{Type: protocol.MsgTypeAuthFail, Error: "invalid secret"})
		conn.Close()
		log.Printf("[ws] auth failed from %s", conn.RemoteAddr())
		return
	}
	if len(authMsg.OpenIds) == 0 {
		_ = conn.WriteJSON(protocol.Message{Type: protocol.MsgTypeAuthFail, Error: "openIds required"})
		conn.Close()
		log.Printf("[ws] auth rejected (no openIds) from %s", conn.RemoteAddr())
		return
	}

	_ = conn.WriteJSON(protocol.Message{Type: protocol.MsgTypeAuthOK})
	conn.SetReadDeadline(time.Time{})
	log.Printf("[ws] client authenticated, openIds=%v", authMsg.OpenIds)

	c := &clientConn{
		conn:    conn,
		done:    make(chan struct{}),
		openIds: authMsg.OpenIds,
	}
	r.registerClient(c)

	go r.readLoop(c)
	go r.pingLoop(c)
}

func (r *relay) readLoop(c *clientConn) {
	defer func() {
		r.unregisterClient(c)
		close(c.done)
		_ = c.conn.Close()
	}()

	c.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	for {
		var msg protocol.Message
		if err := c.conn.ReadJSON(&msg); err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("[ws] read error from %s: %v", c.conn.RemoteAddr(), err)
			}
			return
		}
		c.conn.SetReadDeadline(time.Now().Add(90 * time.Second))

		switch msg.Type {
		case protocol.MsgTypePong:
		case protocol.MsgTypeHTTPResponse:
			r.pendingMu.Lock()
			ch, ok := r.pending[msg.ID]
			if ok {
				delete(r.pending, msg.ID)
			}
			r.pendingMu.Unlock()
			if ok {
				ch <- msg
			}
		default:
			log.Printf("[ws] unknown message type from %s: %s", c.conn.RemoteAddr(), msg.Type)
		}
	}
}

func (r *relay) pingLoop(c *clientConn) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-ticker.C:
			if err := c.writeJSON(protocol.Message{Type: protocol.MsgTypePing}); err != nil {
				log.Printf("[ws] ping write error to %s: %v", c.conn.RemoteAddr(), err)
				return
			}
		}
	}
}

// ── HTTP callback handler ───────────────────────────────────────────────

func (r *relay) handleCallback(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(io.LimitReader(req.Body, 1<<20))
	if err != nil {
		log.Printf("[http] read body error: %v", err)
		writeJSON(w, http.StatusBadRequest, `{"errCode":-1,"errMsg":"read body failed"}`)
		return
	}

	timestamp := req.URL.Query().Get("timestamp")
	nonce := req.URL.Query().Get("nonce")
	signature := req.URL.Query().Get("dev_data_signature")
	if signature == "" {
		signature = req.URL.Query().Get("signature")
	}

	var bodyJSON struct {
		Encrypt     string `json:"encrypt"`
		DataEncrypt string `json:"dataEncrypt"`
		EncryptCap  string `json:"Encrypt"`
	}
	_ = json.Unmarshal(body, &bodyJSON)
	dataEncrypt := bodyJSON.Encrypt
	if dataEncrypt == "" {
		dataEncrypt = bodyJSON.DataEncrypt
	}
	if dataEncrypt == "" {
		dataEncrypt = bodyJSON.EncryptCap
	}
	if dataEncrypt == "" {
		log.Printf("[http] no encrypt/dataEncrypt in payload")
		writeJSON(w, http.StatusOK, `{"errCode":0,"errMsg":"ok"}`)
		return
	}

	route := r.resolveRoute(dataEncrypt, timestamp, nonce, signature)
	if route == nil {
		log.Printf("[http] signature verification failed for all accounts")
		writeJSON(w, http.StatusOK, `{"errCode":0,"errMsg":"ok"}`)
		return
	}

	log.Printf("[http] event: type=%s from=%s groupId=%s routeKey=%s",
		route.eventType, route.from, route.groupId, route.routeKey)

	if route.eventType == "" {
		log.Printf("[http] no routable event type, ignoring")
		writeJSON(w, http.StatusOK, `{"errCode":0,"errMsg":"ok"}`)
		return
	}

	client := r.findClient(route.routeKey)
	if client == nil {
		log.Printf("[http] no client for routeKey=%s, sending error reply", route.routeKey)
		go r.replyNoHandler(route)
		writeJSON(w, http.StatusOK, `{"errCode":0,"errMsg":"ok"}`)
		return
	}

	r.forwardToClient(w, req, body, client)
}

func (r *relay) resolveRoute(dataEncrypt, timestamp, nonce, signature string) *routeResult {
	for name, acc := range r.cfg.Accounts {
		if signature != "" && !crypto.VerifySignature(acc.CallbackSignToken, timestamp, nonce, dataEncrypt, signature) {
			continue
		}

		decrypted, err := crypto.DecryptPayload(dataEncrypt, acc.CallbackKey)
		if err != nil {
			log.Printf("[http] decrypt failed with account %q: %v", name, err)
			continue
		}
		log.Printf("[http] decrypted with account %q: %s", name, truncate(decrypted, 500))

		// The decrypted data is a single event, not wrapped in an "events" array
		var evt callbackEvent
		if err := json.Unmarshal([]byte(decrypted), &evt); err != nil {
			log.Printf("[http] parse decrypted JSON failed: %v", err)
			continue
		}

		switch evt.EventType {
		case "bot_private_message":
			if evt.Data.From != "" {
				return &routeResult{
					eventType: evt.EventType,
					routeKey:  evt.Data.From,
					from:      evt.Data.From,
					account:   acc,
				}
			}
		case "bot_group_message":
			if evt.Data.GroupId != "" {
				return &routeResult{
					eventType: evt.EventType,
					routeKey:  evt.Data.GroupId,
					from:      evt.Data.From,
					groupId:   evt.Data.GroupId,
					account:   acc,
				}
			}
		}

		return &routeResult{account: acc}
	}
	return nil
}

func (r *relay) forwardToClient(w http.ResponseWriter, req *http.Request, body []byte, client *clientConn) {
	headers := make(map[string]string, len(req.Header))
	for k := range req.Header {
		headers[k] = req.Header.Get(k)
	}

	reqID := newID()
	msg := protocol.Message{
		Type:    protocol.MsgTypeHTTPRequest,
		ID:      reqID,
		Method:  req.Method,
		Path:    req.URL.Path,
		Query:   req.URL.RawQuery,
		Headers: headers,
		Body:    string(body),
	}

	ch := make(chan protocol.Message, 1)
	r.pendingMu.Lock()
	r.pending[reqID] = ch
	r.pendingMu.Unlock()

	defer func() {
		r.pendingMu.Lock()
		delete(r.pending, reqID)
		r.pendingMu.Unlock()
	}()

	if err := client.writeJSON(msg); err != nil {
		log.Printf("[http] ws write error to %s: %v", client.conn.RemoteAddr(), err)
		writeJSON(w, http.StatusOK, `{"errCode":0,"errMsg":"ok"}`)
		return
	}

	log.Printf("[http] forwarded %s %s -> %s (client=%s)", req.Method, req.URL.Path, reqID, client.conn.RemoteAddr())

	select {
	case resp := <-ch:
		status := resp.Status
		if status == 0 {
			status = http.StatusOK
		}
		writeJSON(w, status, resp.Body)
		log.Printf("[http] responded %s status=%d", reqID, status)
	case <-client.done:
		log.Printf("[http] client disconnected while waiting for %s", reqID)
		writeJSON(w, http.StatusOK, `{"errCode":0,"errMsg":"ok"}`)
	case <-time.After(2500 * time.Millisecond):
		log.Printf("[http] timeout waiting for %s", reqID)
		writeJSON(w, http.StatusOK, `{"errCode":0,"errMsg":"ok"}`)
	}
}

func (r *relay) replyNoHandler(route *routeResult) {
	token, err := lanxin.GetAppToken(route.account)
	if err != nil {
		log.Printf("[reply] get token failed: %v", err)
		return
	}

	msg := "抱歉，当前没有可用的服务处理您的消息。"

	switch route.eventType {
	case "bot_private_message":
		if err := lanxin.SendPrivateMessage(route.account, token, route.from, msg); err != nil {
			log.Printf("[reply] send private message to %s failed: %v", route.from, err)
		} else {
			log.Printf("[reply] sent 'no handler' to user %s", route.from)
		}
	case "bot_group_message":
		if err := lanxin.SendGroupMessage(route.account, token, route.groupId, msg); err != nil {
			log.Printf("[reply] send group message to %s failed: %v", route.groupId, err)
		} else {
			log.Printf("[reply] sent 'no handler' to group %s", route.groupId)
		}
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

func (r *relay) handleHealth(w http.ResponseWriter, _ *http.Request) {
	r.mu.RLock()
	clientCount := len(r.clients)
	ids := make([]string, 0, len(r.idIndex))
	for id := range r.idIndex {
		ids = append(ids, id)
	}
	r.mu.RUnlock()

	resp := map[string]any{
		"ok":            true,
		"clientCount":   clientCount,
		"registeredIds": ids,
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// ── main ────────────────────────────────────────────────────────────────

func main() {
	flag.Parse()
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	log.Printf("loaded %d account(s) from %s", len(cfg.Accounts), *configPath)

	accountList := make([]string, 0, len(cfg.Accounts))
	for name := range cfg.Accounts {
		accountList = append(accountList, name)
	}
	log.Printf("accounts: %s", strings.Join(accountList, ", "))

	r := newRelay(cfg)

	wsMux := http.NewServeMux()
	wsMux.HandleFunc("/ws", r.handleWS)
	wsServer := &http.Server{Addr: cfg.WsAddr, Handler: wsMux}

	httpMux := http.NewServeMux()
	httpMux.HandleFunc("/health", r.handleHealth)
	httpMux.HandleFunc("/", r.handleCallback)
	httpServer := &http.Server{Addr: cfg.HttpAddr, Handler: httpMux}

	go func() {
		log.Printf("WebSocket server listening on %s", cfg.WsAddr)
		if err := wsServer.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("ws server: %v", err)
		}
	}()
	go func() {
		log.Printf("HTTP callback server listening on %s", cfg.HttpAddr)
		if err := httpServer.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("http server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit

	log.Println("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = wsServer.Shutdown(ctx)
	_ = httpServer.Shutdown(ctx)
}
