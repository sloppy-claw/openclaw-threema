# OpenClaw Threema Channel Plugin

A channel plugin for OpenClaw that enables messaging via Threema Gateway.

## Overview

This plugin enables OpenClaw to send and receive messages through Threema, the privacy-focused messenger, using the official Threema Gateway API.

## Threema Gateway API

### Authentication
- API Identity: 8 characters, usually starts with `*`
- API Secret: Authentication secret from Threema Gateway dashboard

### Two Modes

**Basic Mode (Server-side encryption)**
- Server handles encryption
- Simpler but server knows private key
- No incoming messages support
- URL: `https://msgapi.threema.ch/send_simple`

**E2E Mode (End-to-end encryption)** ← PREFERRED
- Client handles NaCl encryption
- Full privacy
- Supports incoming messages via callback URL
- URL: `https://msgapi.threema.ch/send_e2e`

### Key Endpoints

**Send Message (Basic)**
```
POST https://msgapi.threema.ch/send_simple
Params: from, to|phone|email, text, secret
```

**Send Message (E2E)**
```
POST https://msgapi.threema.ch/send_e2e
Params: from, to, nonce (24 bytes hex), box (encrypted, hex), secret
```

**Lookup**
```
GET https://msgapi.threema.ch/lookup/phone/<E164>
GET https://msgapi.threema.ch/lookup/email/<email>
GET https://msgapi.threema.ch/lookup/id/<threemaId>
```

**Get Public Key**
```
GET https://msgapi.threema.ch/pubkeys/<id>
```

**Receive Messages (E2E only)**
Callback URL receives POST with:
- `from`: Sender Threema ID
- `to`: Your Gateway ID
- `messageId`: Message ID
- `date`: Unix timestamp
- `nonce`: Encryption nonce (hex)
- `box`: Encrypted message (hex)
- `mac`: HMAC for verification

### HTTP Status Codes
- 200: Success
- 400: Invalid recipient or wrong mode
- 401: Invalid credentials
- 402: No credits
- 404: Recipient not found (phone/email lookup)
- 413: Message too long
- 429: Rate limited

### Message Limits
- Text: max 3500 bytes UTF-8
- Encrypted box: max 7812 bytes

## OpenClaw Plugin Structure

Follow the pattern from existing plugins (telegram, bluebubbles):

### Config Schema
```json5
{
  channels: {
    threema: {
      enabled: true,
      apiId: "*YOURID",          // Gateway ID
      apiSecret: "your-secret",  // Gateway secret
      privateKey: "...",         // NaCl private key (hex) for E2E
      mode: "e2e",               // "basic" or "e2e"
      webhookPath: "/threema-webhook",
      dmPolicy: "pairing",       // pairing | allowlist | open | disabled
      allowFrom: [],             // Threema IDs
    }
  }
}
```

### Features to Implement
1. **Send messages** - Text via E2E encrypted API
2. **Receive messages** - Webhook handler for callbacks
3. **Lookup** - Resolve phone/email to Threema ID
4. **Pairing** - Standard OpenClaw pairing flow
5. **Encryption** - NaCl box encryption/decryption

### Dependencies
- `tweetnacl` or `libsodium` for NaCl encryption
- Standard Node.js fetch/https

## Reference

- Threema Gateway API: https://gateway.threema.ch/en/developer/api
- Threema Gateway E2E: https://gateway.threema.ch/en/developer/api/e2e
- Python SDK reference: https://pypi.org/project/threema.gateway/
- OpenClaw BlueBubbles plugin: `/usr/lib/node_modules/openclaw/dist/channels/plugins/bluebubbles*.js`
- OpenClaw Telegram plugin: `/usr/lib/node_modules/openclaw/dist/channels/plugins/telegram.js`

## Development

```bash
# Test send (basic mode)
curl -X POST https://msgapi.threema.ch/send_simple \
  -d "from=*YOURID&to=TARGETID&text=Hello&secret=YOURSECRET"

# Lookup by phone
curl "https://msgapi.threema.ch/lookup/phone/41791234567?from=*YOURID&secret=YOURSECRET"
```
