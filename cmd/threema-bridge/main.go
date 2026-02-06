// Threema Bridge - Go binary for OpenClaw Threema plugin
//
// Communicates via stdin/stdout JSON-RPC style messages.
// Wraps the go-threema library for personal account mode.
package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/karalabe/go-threema"
	"github.com/sloppy-claw/openclaw-threema/pkg/bridge"
)

// Bridge manages the Threema connection and stdio communication
type Bridge struct {
	mu       sync.RWMutex
	id       *threema.Identity
	conn     *threema.Connection
	output   chan *bridge.Event
	shutdown chan struct{}
	wg       sync.WaitGroup

	// Connection state
	backup   string
	password string
}

// NewBridge creates a new bridge instance
func NewBridge() *Bridge {
	return &Bridge{
		output:   make(chan *bridge.Event, 100),
		shutdown: make(chan struct{}),
	}
}

// emit sends an event to the TypeScript process
func (b *Bridge) emit(event *bridge.Event) {
	select {
	case b.output <- event:
	case <-b.shutdown:
	default:
		// Drop event if buffer full (shouldn't happen)
		log.Printf("WARNING: event buffer full, dropping event: %+v", event)
	}
}

// handleConnect processes a connect command
func (b *Bridge) handleConnect(cmd *bridge.Command) error {
	b.mu.Lock()
	defer b.mu.Unlock()

	// Close existing connection if any
	if b.conn != nil {
		b.conn.Close()
		b.conn = nil
	}

	// Store credentials for reconnection
	b.backup = cmd.Backup
	b.password = cmd.Password

	// Load identity from backup
	id, err := threema.Identify(cmd.Backup, cmd.Password)
	if err != nil {
		return fmt.Errorf("failed to load identity: %w", err)
	}
	b.id = id

	// Create handler for incoming messages
	handler := b.createHandler()

	// Connect to Threema servers
	conn, err := threema.Connect(id, handler)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	b.conn = conn

	// Emit connected event
	b.emit(bridge.NewConnectedEvent(id.Self()))

	return nil
}

// createHandler creates a Threema event handler
func (b *Bridge) createHandler() *threema.Handler {
	return &threema.Handler{
		Message: func(from string, nick string, when time.Time, msg string) {
			b.emit(bridge.NewMessageEvent(from, nick, when, msg))
		},
		Spam: func(from string, nick string, when time.Time) {
			// Log spam but don't forward - could add spam event if needed
			log.Printf("Spam from untrusted contact: %s (%s)", from, nick)
		},
		Alert: func(reason string) {
			log.Printf("Threema alert: %s", reason)
		},
		Error: func(reason string, reconnect bool) {
			b.emit(bridge.NewErrorEvent(fmt.Errorf("threema error: %s (reconnect=%v)", reason, reconnect)))
			if reconnect {
				b.scheduleReconnect()
			}
		},
		Closed: func() {
			log.Println("Connection closed, scheduling reconnect...")
			b.scheduleReconnect()
		},
	}
}

// scheduleReconnect attempts to reconnect with exponential backoff
func (b *Bridge) scheduleReconnect() {
	b.wg.Add(1)
	go func() {
		defer b.wg.Done()

		delays := []time.Duration{
			1 * time.Second,
			2 * time.Second,
			5 * time.Second,
			10 * time.Second,
			30 * time.Second,
			60 * time.Second,
		}

		for attempt := 0; ; attempt++ {
			select {
			case <-b.shutdown:
				return
			default:
			}

			delay := delays[min(attempt, len(delays)-1)]
			log.Printf("Reconnecting in %v (attempt %d)...", delay, attempt+1)

			select {
			case <-time.After(delay):
			case <-b.shutdown:
				return
			}

			b.mu.Lock()
			if b.backup == "" || b.password == "" {
				b.mu.Unlock()
				log.Println("No credentials stored, cannot reconnect")
				return
			}

			// Reload identity and reconnect
			id, err := threema.Identify(b.backup, b.password)
			if err != nil {
				b.mu.Unlock()
				log.Printf("Failed to reload identity: %v", err)
				continue
			}
			b.id = id

			handler := b.createHandler()
			conn, err := threema.Connect(id, handler)
			if err != nil {
				b.mu.Unlock()
				log.Printf("Failed to reconnect: %v", err)
				continue
			}

			b.conn = conn
			b.mu.Unlock()

			log.Println("Reconnected successfully")
			b.emit(bridge.NewConnectedEvent(id.Self()))
			return
		}
	}()
}

// handleSend processes a send command
func (b *Bridge) handleSend(cmd *bridge.Command) error {
	b.mu.RLock()
	defer b.mu.RUnlock()

	if b.conn == nil {
		return errors.New("not connected")
	}

	if cmd.To == "" {
		return errors.New("missing 'to' field")
	}

	if cmd.Text == "" {
		return errors.New("missing 'text' field")
	}

	// Trust the recipient if pubkey provided and not already trusted
	if cmd.Pubkey != "" {
		if err := b.id.Trust(cmd.To, cmd.Pubkey); err != nil {
			// Ignore "contact already exists" error
			if err.Error() != "contact already exists" {
				return fmt.Errorf("failed to trust recipient: %w", err)
			}
		}
	}

	// Send the message
	if err := b.conn.SendText(cmd.To, cmd.Text); err != nil {
		return fmt.Errorf("failed to send message: %w", err)
	}

	return nil
}

// handleTrust processes a trust command
func (b *Bridge) handleTrust(cmd *bridge.Command) error {
	b.mu.RLock()
	defer b.mu.RUnlock()

	if b.id == nil {
		return errors.New("not connected")
	}

	if cmd.To == "" {
		return errors.New("missing 'to' field (Threema ID)")
	}

	if cmd.Pubkey == "" {
		return errors.New("missing 'pubkey' field (base64 public key)")
	}

	if err := b.id.Trust(cmd.To, cmd.Pubkey); err != nil {
		// Ignore "contact already exists" error
		if err.Error() != "contact already exists" {
			return fmt.Errorf("failed to trust contact: %w", err)
		}
	}

	return nil
}

// processCommand handles a single command
func (b *Bridge) processCommand(cmd *bridge.Command) {
	var err error

	switch cmd.Cmd {
	case bridge.CmdConnect:
		err = b.handleConnect(cmd)
	case bridge.CmdSend:
		err = b.handleSend(cmd)
	case bridge.CmdTrust:
		err = b.handleTrust(cmd)
	case bridge.CmdPing:
		b.emit(bridge.NewPongEvent())
	default:
		err = fmt.Errorf("unknown command: %s", cmd.Cmd)
	}

	if err != nil {
		b.emit(bridge.NewErrorEvent(err))
	}
}

// readLoop reads commands from stdin
func (b *Bridge) readLoop() {
	defer b.wg.Done()

	scanner := bufio.NewScanner(os.Stdin)
	// Increase buffer size for large messages
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

	for scanner.Scan() {
		select {
		case <-b.shutdown:
			return
		default:
		}

		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		cmd, err := bridge.ParseCommand(line)
		if err != nil {
			b.emit(bridge.NewErrorEvent(fmt.Errorf("invalid command: %w", err)))
			continue
		}

		b.processCommand(cmd)
	}

	if err := scanner.Err(); err != nil && err != io.EOF {
		log.Printf("stdin read error: %v", err)
	}

	// stdin closed, initiate shutdown
	close(b.shutdown)
}

// writeLoop writes events to stdout
func (b *Bridge) writeLoop() {
	defer b.wg.Done()

	encoder := json.NewEncoder(os.Stdout)

	for {
		select {
		case event := <-b.output:
			if err := encoder.Encode(event); err != nil {
				log.Printf("stdout write error: %v", err)
			}
		case <-b.shutdown:
			// Drain remaining events
			for {
				select {
				case event := <-b.output:
					encoder.Encode(event)
				default:
					return
				}
			}
		}
	}
}

// Run starts the bridge and blocks until shutdown
func (b *Bridge) Run() {
	// Handle signals for graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigCh
		log.Println("Received shutdown signal")
		close(b.shutdown)
	}()

	// Start read/write loops
	b.wg.Add(2)
	go b.readLoop()
	go b.writeLoop()

	// Wait for shutdown
	<-b.shutdown

	// Close connection
	b.mu.Lock()
	if b.conn != nil {
		b.conn.Close()
	}
	b.mu.Unlock()

	// Wait for goroutines
	b.wg.Wait()
}

// LookupPublicKey fetches a public key from Threema's directory service
func LookupPublicKey(threemaID string) (string, error) {
	url := fmt.Sprintf("https://api.threema.ch/identity/%s", threemaID)

	resp, err := http.Get(url)
	if err != nil {
		return "", fmt.Errorf("failed to lookup public key: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("lookup failed with status %d", resp.StatusCode)
	}

	var result struct {
		PublicKey string `json:"publicKey"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	return result.PublicKey, nil
}

func main() {
	log.SetPrefix("[threema-bridge] ")
	log.SetFlags(log.Ltime | log.Lmicroseconds)

	bridge := NewBridge()
	bridge.Run()
}
