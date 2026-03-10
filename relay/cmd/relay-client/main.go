package main

import (
	"bytes"
	"flag"
	"fmt"
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
	serverURL = flag.String("server", envOr("LX_RELAY_SERVER", "ws://localhost:8087/ws"), "Relay server WebSocket URL")
	target    = flag.String("target", envOr("LX_RELAY_TARGET", "http://localhost:18789"), "Local OpenClaw base URL (path is preserved from original request)")
	secret    = flag.String("secret", envOr("LX_RELAY_SECRET", "lx-relay-s3cret!"), "Shared authentication secret")
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

type client struct {
	serverURL string
	target    string
	secret    string

	conn    *websocket.Conn
	writeMu sync.Mutex
}

func (c *client) connect() error {
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.Dial(c.serverURL, nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}

	if err := conn.WriteJSON(protocol.Message{
		Type:   protocol.MsgTypeAuth,
		Secret: c.secret,
	}); err != nil {
		conn.Close()
		return fmt.Errorf("auth write: %w", err)
	}

	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	var resp protocol.Message
	if err := conn.ReadJSON(&resp); err != nil {
		conn.Close()
		return fmt.Errorf("auth read: %w", err)
	}
	conn.SetReadDeadline(time.Time{})

	if resp.Type == protocol.MsgTypeAuthFail {
		conn.Close()
		return fmt.Errorf("auth rejected: %s", resp.Error)
	}
	if resp.Type != protocol.MsgTypeAuthOK {
		conn.Close()
		return fmt.Errorf("unexpected auth response: %s", resp.Type)
	}

	c.conn = conn
	log.Printf("[ws] connected to %s", c.serverURL)
	return nil
}

func (c *client) run() {
	defer c.conn.Close()

	c.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	for {
		var msg protocol.Message
		if err := c.conn.ReadJSON(&msg); err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("[ws] read error: %v", err)
			}
			return
		}
		c.conn.SetReadDeadline(time.Now().Add(90 * time.Second))

		switch msg.Type {
		case protocol.MsgTypePing:
			c.writeMu.Lock()
			_ = c.conn.WriteJSON(protocol.Message{Type: protocol.MsgTypePong})
			c.writeMu.Unlock()
		case protocol.MsgTypeHTTPRequest:
			go c.handleRequest(msg)
		default:
			log.Printf("[ws] unknown message type: %s", msg.Type)
		}
	}
}

func (c *client) handleRequest(msg protocol.Message) {
	targetURL := c.target + msg.Path
	if msg.Query != "" {
		targetURL += "?" + msg.Query
	}

	req, err := http.NewRequest(msg.Method, targetURL, bytes.NewReader([]byte(msg.Body)))
	if err != nil {
		log.Printf("[forward] create request error: %v", err)
		c.sendResponse(msg.ID, 500, `{"errCode":-1,"errMsg":"create request failed"}`)
		return
	}
	for k, v := range msg.Headers {
		req.Header.Set(k, v)
	}

	httpClient := &http.Client{Timeout: 5 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		log.Printf("[forward] %s %s -> error: %v", msg.Method, targetURL, err)
		c.sendResponse(msg.ID, 502, `{"errCode":-1,"errMsg":"forward failed"}`)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	log.Printf("[forward] %s %s -> %d (%d bytes)", msg.Method, targetURL, resp.StatusCode, len(body))
	c.sendResponse(msg.ID, resp.StatusCode, string(body))
}

func (c *client) sendResponse(id string, status int, body string) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = c.conn.WriteJSON(protocol.Message{
		Type:   protocol.MsgTypeHTTPResponse,
		ID:     id,
		Status: status,
		Body:   body,
	})
}

func main() {
	flag.Parse()
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)

	c := &client{
		serverURL: *serverURL,
		target:    *target,
		secret:    *secret,
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-quit
		log.Println("shutting down...")
		if c.conn != nil {
			_ = c.conn.WriteMessage(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
			)
			c.conn.Close()
		}
		os.Exit(0)
	}()

	backoff := time.Second
	for {
		if err := c.connect(); err != nil {
			log.Printf("[ws] connect failed: %v (retry in %v)", err, backoff)
			time.Sleep(backoff)
			backoff = min(backoff*2, 30*time.Second)
			continue
		}
		backoff = time.Second
		c.run()
		log.Printf("[ws] disconnected, reconnecting in %v...", backoff)
		time.Sleep(backoff)
	}
}
