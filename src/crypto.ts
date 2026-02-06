/**
 * Threema E2E Encryption using NaCl (tweetnacl)
 *
 * Threema uses NaCl's crypto_box for E2E encryption:
 * - Curve25519 for key exchange
 * - XSalsa20 for symmetric encryption
 * - Poly1305 for authentication
 */

import nacl from 'tweetnacl';
import { MessageType, MessageLimits, type DecryptedMessage } from './types.js';

/**
 * Convert hex string to Uint8Array
 * @throws Error if hex string is invalid
 */
export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string') {
    throw new Error('hexToBytes: input must be a string');
  }

  const cleanHex = hex.replace(/\s/g, '');

  if (cleanHex.length === 0) {
    return new Uint8Array(0);
  }

  if (cleanHex.length % 2 !== 0) {
    throw new Error('hexToBytes: hex string must have even length');
  }

  if (!/^[0-9a-fA-F]+$/.test(cleanHex)) {
    throw new Error('hexToBytes: invalid hex characters');
  }

  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a new NaCl keypair for E2E encryption
 */
export function generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
  return nacl.box.keyPair();
}

/**
 * Generate a random 24-byte nonce
 */
export function generateNonce(): Uint8Array {
  return nacl.randomBytes(24);
}

/**
 * Pad message using PKCS#7 padding (Threema requirement)
 *
 * Per Threema spec: padded data must be at least 32 bytes to prevent
 * length-based information leakage. Padding length is 1-255 bytes,
 * where each padding byte contains the padding length value.
 */
export function padMessage(message: Uint8Array): Uint8Array {
  const MIN_PADDED_SIZE = 32;
  const MAX_PADDING = 255;

  let paddingLength: number;

  if (message.length < MIN_PADDED_SIZE) {
    paddingLength = MIN_PADDED_SIZE - message.length;
  } else {
    paddingLength = MessageLimits.PADDING_BLOCK_SIZE -
      (message.length % MessageLimits.PADDING_BLOCK_SIZE);
    if (paddingLength === 0) {
      paddingLength = MessageLimits.PADDING_BLOCK_SIZE;
    }
  }

  paddingLength = Math.min(paddingLength, MAX_PADDING);

  const padded = new Uint8Array(message.length + paddingLength);
  padded.set(message);
  padded.fill(paddingLength, message.length);
  return padded;
}

/**
 * Remove PKCS#7 padding from message
 * @throws Error if padding is invalid
 */
export function unpadMessage(padded: Uint8Array): Uint8Array {
  if (padded.length === 0) {
    throw new Error('unpadMessage: empty input');
  }

  const paddingLength = padded[padded.length - 1];

  if (paddingLength === 0 || paddingLength > padded.length) {
    throw new Error('unpadMessage: invalid padding length');
  }

  for (let i = padded.length - paddingLength; i < padded.length; i++) {
    if (padded[i] !== paddingLength) {
      throw new Error('unpadMessage: invalid padding bytes');
    }
  }

  return padded.slice(0, padded.length - paddingLength);
}

/**
 * Encrypt a text message for E2E mode
 *
 * @param text - Message text (UTF-8)
 * @param recipientPublicKey - Recipient's NaCl public key (32 bytes)
 * @param senderSecretKey - Sender's NaCl secret key (32 bytes)
 * @returns Object with nonce and encrypted box (both as Uint8Array)
 */
export function encryptTextMessage(
  text: string,
  recipientPublicKey: Uint8Array,
  senderSecretKey: Uint8Array
): { nonce: Uint8Array; box: Uint8Array } {
  // Encode text as UTF-8
  const textBytes = new TextEncoder().encode(text);

  // Check message length limit
  if (textBytes.length > MessageLimits.TEXT_MAX_BYTES) {
    throw new Error(`Message exceeds maximum length of ${MessageLimits.TEXT_MAX_BYTES} bytes`);
  }

  // Prepend message type byte (0x01 for text)
  const messageWithType = new Uint8Array(1 + textBytes.length);
  messageWithType[0] = MessageType.Text;
  messageWithType.set(textBytes, 1);

  // Pad the message
  const paddedMessage = padMessage(messageWithType);

  // Generate random nonce
  const nonce = generateNonce();

  // Encrypt using NaCl box
  const box = nacl.box(paddedMessage, nonce, recipientPublicKey, senderSecretKey);

  return { nonce, box };
}

/**
 * Decrypt a message from E2E mode
 *
 * @param box - Encrypted message (Uint8Array)
 * @param nonce - Nonce used for encryption (24 bytes)
 * @param senderPublicKey - Sender's NaCl public key (32 bytes)
 * @param recipientSecretKey - Recipient's NaCl secret key (32 bytes)
 * @returns Decrypted message or null if decryption fails
 */
export function decryptMessage(
  box: Uint8Array,
  nonce: Uint8Array,
  senderPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array
): DecryptedMessage | null {
  const decrypted = nacl.box.open(box, nonce, senderPublicKey, recipientSecretKey);

  if (!decrypted) {
    return null;
  }

  let unpadded: Uint8Array;
  try {
    unpadded = unpadMessage(decrypted);
  } catch {
    return null;
  }

  if (unpadded.length < 1) {
    return null;
  }

  const type = unpadded[0] as MessageType;
  const payload = unpadded.slice(1);

  const result: DecryptedMessage = {
    type,
    raw: payload,
  };

  if (type === MessageType.Text) {
    result.text = new TextDecoder().decode(payload);
  }

  return result;
}

/**
 * Compute HMAC-SHA256 for webhook MAC verification
 *
 * MAC = HMAC-SHA256(key=apiSecret, data=from+to+messageId+date+nonce+box)
 */
export async function computeWebhookMac(
  apiSecret: string,
  from: string,
  to: string,
  messageId: string,
  date: string,
  nonce: string,
  box: string
): Promise<string> {
  const data = from + to + messageId + date + nonce + box;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));

  return bytesToHex(new Uint8Array(signature));
}

/**
 * Verify webhook MAC
 */
export async function verifyWebhookMac(
  apiSecret: string,
  from: string,
  to: string,
  messageId: string,
  date: string,
  nonce: string,
  box: string,
  mac: string
): Promise<boolean> {
  const expectedMac = await computeWebhookMac(apiSecret, from, to, messageId, date, nonce, box);
  const normalizedMac = mac.toLowerCase();

  if (expectedMac.length !== normalizedMac.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < expectedMac.length; i++) {
    diff |= expectedMac.charCodeAt(i) ^ normalizedMac.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Derive public key from secret key
 */
export function getPublicKeyFromSecretKey(secretKey: Uint8Array): Uint8Array {
  const keyPair = nacl.box.keyPair.fromSecretKey(secretKey);
  return keyPair.publicKey;
}
