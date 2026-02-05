# Threema Gateway API Reference

Base URL: `https://msgapi.threema.ch`

## Authentication

All requests need:
- `from`: API identity (8 chars, starts with `*`)
- `secret`: API authentication secret

## Endpoints

### Send Simple (Basic Mode)
```
POST /send_simple
Content-Type: application/x-www-form-urlencoded

from=*YOURID&to=TARGETID&text=Hello&secret=YOURSECRET
```

Recipients (choose one):
- `to`: Threema ID (8 chars)
- `phone`: E.164 phone (without +)
- `email`: Email address

### Send E2E (End-to-End Mode)
```
POST /send_e2e
Content-Type: application/x-www-form-urlencoded

from=*YOURID&to=TARGETID&nonce=<24bytes_hex>&box=<encrypted_hex>&secret=YOURSECRET
```

Optional params:
- `noDeliveryReceipts`: Set to 1 to disable
- `noPush`: Set to 1 to skip push notification

### Lookup

By phone:
```
GET /lookup/phone/<E164_number>?from=*YOURID&secret=YOURSECRET
```

By email:
```
GET /lookup/email/<email>?from=*YOURID&secret=YOURSECRET
```

By email hash:
```
GET /lookup/email_hash/<sha256_lowercase_email>?from=*YOURID&secret=YOURSECRET
```

### Public Key
```
GET /pubkeys/<threemaId>?from=*YOURID&secret=YOURSECRET
```

Returns 256-bit public key as hex.

### Check Credits
```
GET /credits?from=*YOURID&secret=YOURSECRET
```

### Capabilities
```
GET /capabilities/<threemaId>?from=*YOURID&secret=YOURSECRET
```

## Incoming Messages (Webhook Callback)

Configure callback URL in Threema Gateway dashboard.

POST body (application/x-www-form-urlencoded):
- `from`: Sender Threema ID
- `to`: Your Gateway ID
- `messageId`: Unique message ID
- `date`: Unix timestamp
- `nonce`: 24 bytes hex
- `box`: Encrypted message hex
- `mac`: HMAC-SHA256 for verification (hex)

### MAC Verification
```
mac = HMAC-SHA256(key=apiSecret, data=from+to+messageId+date+nonce+box)
```

## E2E Encryption

Uses NaCl `crypto_box` (Curve25519, XSalsa20, Poly1305).

### Encrypt
```javascript
const nonce = randomBytes(24);
const box = nacl.box(message, nonce, recipientPublicKey, senderPrivateKey);
```

### Decrypt
```javascript
const message = nacl.box.open(box, nonce, senderPublicKey, recipientPrivateKey);
```

### Message Padding
Pad messages to nearest multiple of 256 bytes:
```
paddedLength = (message.length + 1 + 255) & ~255
padding = 0x80 + (paddedLength - message.length - 1) * 0x00
```

## HTTP Status Codes
- 200: Success
- 400: Invalid request
- 401: Auth failed
- 402: No credits
- 404: Not found
- 413: Too long
- 429: Rate limited
- 500: Server error

## Message Types (in E2E encrypted box)

Type byte at start of decrypted message:
- 0x01: Text message
- 0x02: Image
- 0x03: Location  
- 0x10: Video
- 0x12: Audio
- 0x17: File
- 0x80: Delivery receipt
- 0x81: Typing indicator

For text (0x01), rest of payload is UTF-8 text.

## Rate Limits
- Varies by plan
- HTTP 429 when exceeded
