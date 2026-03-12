package main

import (
	"context"
	"errors"
	"io"
	"log"
	"net"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

const (
	defaultListenAddr   = ":443"
	defaultUpstreamHost = "openrouter.ai"
	defaultUpstreamPort = "443"
	defaultDialTimeout  = 10 * time.Second
)

type server struct {
	listener     net.Listener
	upstreamAddr string
	dialTimeout  time.Duration
	logger       *log.Logger

	shuttingDown atomic.Bool
	connections  sync.WaitGroup
}

func main() {
	logger := log.New(os.Stdout, "[openrouter-proxy] ", log.LstdFlags|log.Lmicroseconds)

	listenAddr := getEnv("LISTEN_ADDR", defaultListenAddr)
	upstreamHost := getEnv("UPSTREAM_HOST", defaultUpstreamHost)
	upstreamPort := getEnv("UPSTREAM_PORT", defaultUpstreamPort)
	upstreamAddr := net.JoinHostPort(upstreamHost, upstreamPort)
	dialTimeout := parseDialTimeout(getEnv("DIAL_TIMEOUT_SECONDS", "10"), logger)

	ln, err := net.Listen("tcp", listenAddr)
	if err != nil {
		logger.Fatalf("listen failed on %s: %v", listenAddr, err)
	}

	srv := &server{
		listener:     ln,
		upstreamAddr: upstreamAddr,
		dialTimeout:  dialTimeout,
		logger:       logger,
	}

	logger.Printf("listening on %s, forwarding to %s", listenAddr, upstreamAddr)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go srv.serve()

	<-ctx.Done()
	logger.Printf("shutdown signal received")
	srv.shutdown()
	logger.Printf("shutdown complete")
}

func (s *server) serve() {
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			if s.shuttingDown.Load() {
				return
			}
			s.logger.Printf("accept error: %v", err)
			time.Sleep(50 * time.Millisecond)
			continue
		}

		s.connections.Add(1)
		go func(clientConn net.Conn) {
			defer s.connections.Done()
			s.handleConnection(clientConn)
		}(conn)
	}
}

func (s *server) handleConnection(clientConn net.Conn) {
	clientAddr := clientConn.RemoteAddr().String()
	s.logger.Printf("new connection from %s", clientAddr)
	setKeepAlive(clientConn)
	defer func() {
		_ = clientConn.Close()
		s.logger.Printf("connection closed from %s", clientAddr)
	}()

	dialer := net.Dialer{Timeout: s.dialTimeout, KeepAlive: 30 * time.Second}
	upstreamConn, err := dialer.Dial("tcp", s.upstreamAddr)
	if err != nil {
		s.logger.Printf("dial upstream failed for %s: %v", clientAddr, err)
		return
	}
	defer func() {
		_ = upstreamConn.Close()
	}()

	// Bidirectional stream copy keeps TLS opaque and untouched.
	copyBothWays(clientConn, upstreamConn)
}

func (s *server) shutdown() {
	s.shuttingDown.Store(true)
	_ = s.listener.Close()

	done := make(chan struct{})
	go func() {
		s.connections.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		s.logger.Printf("timeout waiting for active connections to close")
	}
}

func copyBothWays(a net.Conn, b net.Conn) {
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		_, _ = io.Copy(a, b)
		_ = closeWrite(a)
	}()

	go func() {
		defer wg.Done()
		_, _ = io.Copy(b, a)
		_ = closeWrite(b)
	}()

	wg.Wait()
}

func closeWrite(conn net.Conn) error {
	type closeWriter interface {
		CloseWrite() error
	}
	cw, ok := conn.(closeWriter)
	if !ok {
		return conn.Close()
	}
	if err := cw.CloseWrite(); err != nil && !errors.Is(err, net.ErrClosed) {
		return err
	}
	return nil
}

func parseDialTimeout(raw string, logger *log.Logger) time.Duration {
	v := strings.TrimSpace(raw)
	seconds, err := strconv.Atoi(v)
	if err != nil || seconds <= 0 {
		logger.Printf("invalid DIAL_TIMEOUT_SECONDS=%q, fallback to %d", raw, int(defaultDialTimeout.Seconds()))
		return defaultDialTimeout
	}
	return time.Duration(seconds) * time.Second
}

func setKeepAlive(conn net.Conn) {
	if tc, ok := conn.(*net.TCPConn); ok {
		_ = tc.SetKeepAlive(true)
		_ = tc.SetKeepAlivePeriod(30 * time.Second)
	}
}

func getEnv(key string, fallback string) string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	return v
}
