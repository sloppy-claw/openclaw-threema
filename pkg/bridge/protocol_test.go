package bridge

import (
	"errors"
	"testing"
	"time"
)

func TestParseCommand(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    *Command
		wantErr bool
	}{
		{
			name:  "connect command",
			input: `{"cmd":"connect","backup":"XXXX-XXXX","password":"secret"}`,
			want: &Command{
				Cmd:      CmdConnect,
				Backup:   "XXXX-XXXX",
				Password: "secret",
			},
		},
		{
			name:  "send command",
			input: `{"cmd":"send","to":"ABCD1234","text":"Hello!"}`,
			want: &Command{
				Cmd:  CmdSend,
				To:   "ABCD1234",
				Text: "Hello!",
			},
		},
		{
			name:  "send with pubkey",
			input: `{"cmd":"send","to":"ABCD1234","pubkey":"base64key==","text":"Hi"}`,
			want: &Command{
				Cmd:    CmdSend,
				To:     "ABCD1234",
				Pubkey: "base64key==",
				Text:   "Hi",
			},
		},
		{
			name:  "trust command",
			input: `{"cmd":"trust","to":"EFGH5678","pubkey":"pubkey=="}`,
			want: &Command{
				Cmd:    CmdTrust,
				To:     "EFGH5678",
				Pubkey: "pubkey==",
			},
		},
		{
			name:  "ping command",
			input: `{"cmd":"ping"}`,
			want: &Command{
				Cmd: CmdPing,
			},
		},
		{
			name:    "invalid json",
			input:   `{not valid json}`,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseCommand([]byte(tt.input))
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseCommand() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.wantErr {
				return
			}
			if got.Cmd != tt.want.Cmd {
				t.Errorf("Cmd = %v, want %v", got.Cmd, tt.want.Cmd)
			}
			if got.Backup != tt.want.Backup {
				t.Errorf("Backup = %v, want %v", got.Backup, tt.want.Backup)
			}
			if got.Password != tt.want.Password {
				t.Errorf("Password = %v, want %v", got.Password, tt.want.Password)
			}
			if got.To != tt.want.To {
				t.Errorf("To = %v, want %v", got.To, tt.want.To)
			}
			if got.Pubkey != tt.want.Pubkey {
				t.Errorf("Pubkey = %v, want %v", got.Pubkey, tt.want.Pubkey)
			}
			if got.Text != tt.want.Text {
				t.Errorf("Text = %v, want %v", got.Text, tt.want.Text)
			}
		})
	}
}

func TestNewConnectedEvent(t *testing.T) {
	event := NewConnectedEvent("MYID1234")
	if event.Event != EventConnected {
		t.Errorf("Event = %v, want %v", event.Event, EventConnected)
	}
	if event.ID != "MYID1234" {
		t.Errorf("ID = %v, want MYID1234", event.ID)
	}
}

func TestNewMessageEvent(t *testing.T) {
	when := time.Date(2026, 2, 6, 12, 0, 0, 0, time.UTC)
	event := NewMessageEvent("SENDER01", "Alice", when, "Hello!")

	if event.Event != EventMessage {
		t.Errorf("Event = %v, want %v", event.Event, EventMessage)
	}
	if event.From != "SENDER01" {
		t.Errorf("From = %v, want SENDER01", event.From)
	}
	if event.Nick != "Alice" {
		t.Errorf("Nick = %v, want Alice", event.Nick)
	}
	if event.Time != "2026-02-06T12:00:00Z" {
		t.Errorf("Time = %v, want 2026-02-06T12:00:00Z", event.Time)
	}
	if event.Text != "Hello!" {
		t.Errorf("Text = %v, want Hello!", event.Text)
	}
}

func TestNewErrorEvent(t *testing.T) {
	err := errors.New("something went wrong")
	event := NewErrorEvent(err)

	if event.Event != EventError {
		t.Errorf("Event = %v, want %v", event.Event, EventError)
	}
	if event.Error != "something went wrong" {
		t.Errorf("Error = %v, want something went wrong", event.Error)
	}
}

func TestEventToJSON(t *testing.T) {
	event := NewPongEvent()
	data, err := event.ToJSON()
	if err != nil {
		t.Fatalf("ToJSON() error = %v", err)
	}

	expected := `{"event":"pong"}`
	if string(data) != expected {
		t.Errorf("ToJSON() = %s, want %s", string(data), expected)
	}
}
