// Package bridge defines JSON-RPC message types for communication between
// the TypeScript plugin and the Go Threema bridge.
package bridge

import (
	"encoding/json"
	"time"
)

// Command types sent from TypeScript to Go
const (
	CmdConnect = "connect"
	CmdSend    = "send"
	CmdTrust   = "trust"
	CmdPing    = "ping"
)

// Event types sent from Go to TypeScript
const (
	EventConnected = "connected"
	EventMessage   = "message"
	EventError     = "error"
	EventPong      = "pong"
)

// Command is a message from TypeScript to Go
type Command struct {
	Cmd      string `json:"cmd"`
	Backup   string `json:"backup,omitempty"`   // For connect
	Password string `json:"password,omitempty"` // For connect
	To       string `json:"to,omitempty"`       // For send/trust (8-char Threema ID)
	Pubkey   string `json:"pubkey,omitempty"`   // For send/trust (base64 public key)
	Text     string `json:"text,omitempty"`     // For send
}

// Event is a message from Go to TypeScript
type Event struct {
	Event string `json:"event"`
	ID    string `json:"id,omitempty"`    // For connected (own Threema ID)
	From  string `json:"from,omitempty"`  // For message
	Nick  string `json:"nick,omitempty"`  // For message
	Time  string `json:"time,omitempty"`  // For message (RFC3339)
	Text  string `json:"text,omitempty"`  // For message
	Error string `json:"error,omitempty"` // For error
}

// ParseCommand parses a JSON command from stdin
func ParseCommand(data []byte) (*Command, error) {
	var cmd Command
	if err := json.Unmarshal(data, &cmd); err != nil {
		return nil, err
	}
	return &cmd, nil
}

// NewConnectedEvent creates a connected event
func NewConnectedEvent(id string) *Event {
	return &Event{
		Event: EventConnected,
		ID:    id,
	}
}

// NewMessageEvent creates a message event
func NewMessageEvent(from, nick string, when time.Time, text string) *Event {
	return &Event{
		Event: EventMessage,
		From:  from,
		Nick:  nick,
		Time:  when.Format(time.RFC3339),
		Text:  text,
	}
}

// NewErrorEvent creates an error event
func NewErrorEvent(err error) *Event {
	return &Event{
		Event: EventError,
		Error: err.Error(),
	}
}

// NewPongEvent creates a pong event
func NewPongEvent() *Event {
	return &Event{
		Event: EventPong,
	}
}

// ToJSON serializes an event to JSON
func (e *Event) ToJSON() ([]byte, error) {
	return json.Marshal(e)
}
