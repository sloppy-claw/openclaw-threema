# Threema Gateway Setup Guide

## What You Need

To use this plugin, you need:
1. **Threema Gateway Account** (paid, CHF-based)
2. **Gateway ID** (8 chars, starts with `*`) 
3. **API Secret** (given after ID approval)
4. **Private Key** (you generate this yourself)

## Step-by-Step Setup

### 1. Create Threema Gateway Account

Go to: https://gateway.threema.ch/en

Click **Register** and create an account. This is separate from regular Threema app accounts.

### 2. Buy Credits

Threema Gateway charges per message. Pricing:
- **CHF 0.04 per message** (roughly $0.05 USD)
- Credits are prepaid, minimum purchase ~CHF 50

Log into your Gateway dashboard and add credits.

### 3. Generate Your Keypair

You need to generate a NaCl keypair locally. The private key stays with you, public key goes to Threema.

**Option A: Using our plugin's built-in tool**
```bash
cd /root/Projects/openclaw-threema
npx tsx -e "
import { generateKeyPair, bytesToHex } from './src/crypto.js';
const kp = generateKeyPair();
console.log('Private Key (keep secret!):', bytesToHex(kp.secretKey));
console.log('Public Key (submit to Threema):', bytesToHex(kp.publicKey));
"
```

**Option B: Using Threema's PHP tool**
```bash
# Download SDK
wget https://gateway.threema.ch/sdk/threema-msgapi-sdk-php-2.3.1.zip
unzip threema-msgapi-sdk-php-2.3.1.zip
cd threema-msgapi-sdk-php-2.3.1

# Generate keys
./threema-msgapi-tool -g privateKey.txt publicKey.txt

# View keys
cat privateKey.txt  # Format: private:abc123...
cat publicKey.txt   # Format: public:def456...
```

**Option C: Using Python**
```bash
pip install threema.gateway
python3 -c "
from threema.gateway import generate_key_pair
private, public = generate_key_pair()
print('Private:', private.hex())
print('Public:', public.hex())
"
```

### 4. Request E2E Gateway ID

1. Log into https://gateway.threema.ch
2. Go to **ID** → **Request Threema ID**
3. Select **End-to-End Mode** (important!)
4. Enter desired ID (8 chars, e.g., `*SLOPBOT`)
5. Paste your **public key** from step 3

⚠️ **CRITICAL**: Back up your private key! If you lose it, the Gateway ID becomes permanently unusable. Threema cannot recover it.

### 5. Wait for Approval

- Manual review process, takes 1-3 business days
- Swiss business hours (CET/CEST)
- You'll receive an email when approved

### 6. Get Your API Secret

After approval:
1. Log into Gateway dashboard
2. Go to your ID settings
3. Copy the **API Secret** (shown once, save it!)

### 7. Configure Webhook (for receiving messages)

To receive messages, set a callback URL:
1. Go to your Gateway ID settings
2. Set **Callback URL** to your public endpoint, e.g.:
   - `https://your-server.com/threema-webhook`
   - Or use Tailscale funnel for testing

### 8. Configure OpenClaw

Add to your OpenClaw config:

```json5
{
  channels: {
    threema: {
      enabled: true,
      apiId: "*YOURID",           // Your Gateway ID
      apiSecret: "your-secret",    // API secret from step 6
      privateKey: "abc123...",     // 64-char hex private key from step 3
      mode: "e2e",                 // Always use E2E mode
      webhookPath: "/threema-webhook",
      dmPolicy: "pairing"          // or "open" for testing
    }
  }
}
```

### 9. Restart OpenClaw

```bash
openclaw gateway restart
```

### 10. Test It!

**Send a test message from OpenClaw:**
```bash
openclaw message send --channel threema --to ECHOECHO --message "Hello Threema!"
```

The `ECHOECHO` ID is Threema's test endpoint - it echoes back your message.

**Send to a real Threema user:**
- You need their Threema ID (visible in their profile)
- Or look them up by phone: `curl "https://msgapi.threema.ch/lookup/phone/41791234567?from=*YOURID&secret=SECRET"`

## Cost Breakdown

| Action | Cost |
|--------|------|
| Send message | CHF 0.04 |
| Send to phone/email (includes lookup) | CHF 0.05 |
| Receive message | Free |
| ID lookup | CHF 0.01 |
| Public key lookup | Free |
| Blob upload (files) | CHF 0.04 |

## Troubleshooting

**401 Unauthorized**: Wrong API ID or secret

**402 Payment Required**: No credits left, buy more at gateway.threema.ch

**404 Not Found** (on lookup): User doesn't have Threema or hasn't linked phone/email

**Webhook not receiving**: 
- Check your callback URL is HTTPS with valid cert (not self-signed)
- Check firewall allows inbound connections
- Verify MAC signature in incoming requests

## Security Notes

- Your **private key** never leaves your server
- All messages are encrypted client-side before sending
- Threema never sees message content in E2E mode
- Back up your private key securely!

## Resources

- [Threema Gateway Dashboard](https://gateway.threema.ch)
- [API Documentation](https://gateway.threema.ch/en/developer/api)
- [E2E Encryption Details](https://gateway.threema.ch/en/developer/api/e2e)
- [Official Python SDK](https://github.com/threema-ch/threema-msgapi-sdk-python)
- [Official PHP SDK](https://gateway.threema.ch/en/developer/sdk-php)
