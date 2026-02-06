# OpenClaw Threema Plugin

A channel plugin for OpenClaw that enables messaging via Threema using a **personal account** (not Gateway API).

## Features

- 🔒 End-to-end encrypted messaging via Threema
- 💰 **No per-message costs** - just a one-time CHF 6 Threema license
- 🔄 Automatic reconnection with exponential backoff
- 📱 Uses go-threema library for personal account mode

## Architecture

```
┌─────────────────┐     JSON/stdio     ┌──────────────────┐
│  OpenClaw       │◄──────────────────►│  threema-bridge  │
│  (TypeScript)   │                    │  (Go binary)     │
└─────────────────┘                    └────────┬─────────┘
                                                │
                                                ▼
                                       ┌──────────────────┐
                                       │  Threema Servers │
                                       └──────────────────┘
```

The TypeScript plugin spawns a Go binary (`threema-bridge`) that handles the Threema protocol. Communication happens via JSON over stdin/stdout.

## Setup

### 1. Get a Threema License

Buy a Threema Android license at https://shop.threema.ch (~CHF 6 one-time).

### 2. Create & Export Identity

1. Install Threema on a phone or Android emulator
2. Create your ID using the license key
3. Export your identity: **Settings → My ID → Export**
4. Save the 80-character backup key and password

### 3. Install Plugin

```bash
# Clone the repo
git clone https://github.com/sloppy-claw/openclaw-threema.git
cd openclaw-threema

# Build the Go bridge binary
go build -o threema-bridge ./cmd/threema-bridge/

# Or download pre-built from releases
```

### 4. Configure OpenClaw

Add to your OpenClaw config:

```json5
{
  channels: {
    threema: {
      enabled: true,
      backup: "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX",
      password: "your-backup-password",
      contacts: {
        "ABCD1234": "base64-public-key-here"
      },
      dmPolicy: "pairing"
    }
  }
}
```

### 5. Get Contact Public Keys

To message someone, you need their public key. Get it from Threema's directory:

```bash
curl https://api.threema.ch/identity/ABCD1234 | jq .publicKey
```

Or scan their QR code in the Threema app.

## Configuration

| Field | Type | Description |
|-------|------|-------------|
| `backup` | string | 80-char exported identity backup |
| `password` | string | Backup decryption password |
| `contacts` | object | Map of Threema ID → base64 public key |
| `dmPolicy` | string | `open`, `pairing`, or `allowlist` |
| `allowFrom` | array | Allowed Threema IDs (for allowlist mode) |

## Bridge Protocol

The Go bridge communicates via JSON over stdin/stdout:

**Commands (TypeScript → Go):**
```json
{"cmd":"connect","backup":"...","password":"..."}
{"cmd":"send","to":"ABCD1234","text":"Hello!","pubkey":"..."}
{"cmd":"trust","to":"ABCD1234","pubkey":"..."}
{"cmd":"ping"}
```

**Events (Go → TypeScript):**
```json
{"event":"connected","id":"MYID1234"}
{"event":"message","from":"ABCD1234","nick":"Alice","time":"...","text":"Hi!"}
{"event":"error","error":"..."}
{"event":"pong"}
```

## Building

```bash
# Build Go binary
go build -ldflags="-s -w" -o threema-bridge ./cmd/threema-bridge/

# Run tests
go test -v ./...

# Type-check TypeScript
npx tsc --noEmit
```

## Comparison: Personal vs Gateway

| Aspect | Personal (this plugin) | Gateway |
|--------|------------------------|---------|
| Cost | CHF 6 one-time | CHF 50+ setup + CHF 0.04/msg |
| Stability | Unofficial, may break | Official, supported |
| ToS | "Tolerated" | Allowed |
| Groups | Limited | Full support |
| Receive | Requires running daemon | Webhook callback |

## License

MIT

## Credits

- [go-threema](https://github.com/karalabe/go-threema) by karalabe
- [Threema](https://threema.ch) - the privacy-focused messenger
