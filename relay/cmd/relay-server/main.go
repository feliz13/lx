package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"

	"lx-relay/protocol"
)

var (
	httpAddr = flag.String("http-addr", envOr("LX_HTTP_ADDR", ":8088"), "HTTP listen address for Lanxin callbacks")
	wsAddr   = flag.String("ws-addr", envOr("LX_WS_ADDR", ":8087"), "WebSocket listen address for relay client")
	secret   = flag.String("secret", envOr("LX_RELAY_SECRET", "lx-relay-s3cret!"), "Shared authentication secret")
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

// relay holds the state for a single connected client.
type relay struct {
	secret string

	mu      sync.RWMutex
	conn    *websocket.Conn
	writeMu sync.Mutex
	done    chan struct{}

	pendingMu sync.Mutex
	pending   map[string]chan protocol.Message
}

func newRelay(secret string) *relay {
	return &relay{
		secret:  secret,
		done:    make(chan struct{}),
		pending: make(map[string]chan protocol.Message),
	}
}

// ── WebSocket handler (relay client connects here) ──────────────────────

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
	if authMsg.Type != protocol.MsgTypeAuth || authMsg.Secret != r.secret {
		_ = conn.WriteJSON(protocol.Message{Type: protocol.MsgTypeAuthFail, Error: "invalid secret"})
		conn.Close()
		log.Printf("[ws] auth failed from %s", conn.RemoteAddr())
		return
	}
	_ = conn.WriteJSON(protocol.Message{Type: protocol.MsgTypeAuthOK})
	conn.SetReadDeadline(time.Time{})
	log.Printf("[ws] client authenticated")

	r.mu.Lock()
	if r.conn != nil {
		log.Printf("[ws] replacing previous client")
		_ = r.conn.Close()
		close(r.done)
	}
	r.conn = conn
	r.done = make(chan struct{})
	done := r.done
	r.mu.Unlock()

	go r.readLoop(conn, done)
	go r.pingLoop(conn, done)
}

func (r *relay) readLoop(conn *websocket.Conn, done chan struct{}) {
	defer func() {
		r.mu.Lock()
		if r.conn == conn {
			r.conn = nil
			close(r.done)
		}
		r.mu.Unlock()
		_ = conn.Close()
		log.Printf("[ws] client disconnected")
	}()

	conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	for {
		var msg protocol.Message
		if err := conn.ReadJSON(&msg); err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("[ws] read error: %v", err)
			}
			return
		}
		conn.SetReadDeadline(time.Now().Add(90 * time.Second))

		switch msg.Type {
		case protocol.MsgTypePong:
			// heartbeat OK
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
			log.Printf("[ws] unknown message type: %s", msg.Type)
		}
	}
}

func (r *relay) pingLoop(conn *websocket.Conn, done chan struct{}) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			r.writeMu.Lock()
			err := conn.WriteJSON(protocol.Message{Type: protocol.MsgTypePing})
			r.writeMu.Unlock()
			if err != nil {
				log.Printf("[ws] ping write error: %v", err)
				return
			}
		}
	}
}

// ── HTTP handler (Lanxin callbacks arrive here) ─────────────────────────

func (r *relay) handleCallback(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	r.mu.RLock()
	conn := r.conn
	done := r.done
	r.mu.RUnlock()

	if conn == nil {
		log.Printf("[http] no client connected, returning default OK")
		writeJSON(w, http.StatusOK, `{"errCode":0,"errMsg":"ok"}`)
		return
	}

	body, err := io.ReadAll(io.LimitReader(req.Body, 1<<20))
	if err != nil {
		log.Printf("[http] read body error: %v", err)
		writeJSON(w, http.StatusBadRequest, `{"errCode":-1,"errMsg":"read body failed"}`)
		return
	}

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

	r.writeMu.Lock()
	wErr := conn.WriteJSON(msg)
	r.writeMu.Unlock()
	if wErr != nil {
		log.Printf("[http] ws write error: %v", wErr)
		writeJSON(w, http.StatusOK, `{"errCode":0,"errMsg":"ok"}`)
		return
	}

	log.Printf("[http] forwarded %s %s -> %s", req.Method, req.URL.Path, reqID)

	select {
	case resp := <-ch:
		status := resp.Status
		if status == 0 {
			status = http.StatusOK
		}
		writeJSON(w, status, resp.Body)
		log.Printf("[http] responded %s status=%d", reqID, status)
	case <-done:
		log.Printf("[http] client disconnected while waiting for %s", reqID)
		writeJSON(w, http.StatusOK, `{"errCode":0,"errMsg":"ok"}`)
	case <-time.After(2500 * time.Millisecond):
		log.Printf("[http] timeout waiting for %s", reqID)
		writeJSON(w, http.StatusOK, `{"errCode":0,"errMsg":"ok"}`)
	}
}

func writeJSON(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}

// ── Healthcheck ─────────────────────────────────────────────────────────

func (r *relay) handleHealth(w http.ResponseWriter, _ *http.Request) {
	r.mu.RLock()
	connected := r.conn != nil
	r.mu.RUnlock()
	resp := map[string]any{"ok": true, "clientConnected": connected}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// ── main ────────────────────────────────────────────────────────────────

func main() {
	flag.Parse()
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)

	r := newRelay(*secret)

	wsMux := http.NewServeMux()
	wsMux.HandleFunc("/ws", r.handleWS)
	wsServer := &http.Server{Addr: *wsAddr, Handler: wsMux}

	httpMux := http.NewServeMux()
	httpMux.HandleFunc("/health", r.handleHealth)
	httpMux.HandleFunc("/", r.handleCallback)
	httpServer := &http.Server{Addr: *httpAddr, Handler: httpMux}

	go func() {
		log.Printf("WebSocket server listening on %s", *wsAddr)
		if err := wsServer.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("ws server: %v", err)
		}
	}()
	go func() {
		log.Printf("HTTP callback server listening on %s", *httpAddr)
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
