/**
 * Crypto module unit tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hexToBytes,
  bytesToHex,
  generateKeyPair,
  generateNonce,
  padMessage,
  unpadMessage,
  encryptTextMessage,
  decryptMessage,
  getPublicKeyFromSecretKey,
  computeWebhookMac,
  verifyWebhookMac,
} from '../src/crypto.js';

describe('hexToBytes', () => {
  it('converts valid hex to bytes', () => {
    const result = hexToBytes('48656c6c6f');
    assert.deepEqual(result, new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
  });

  it('handles empty string', () => {
    const result = hexToBytes('');
    assert.deepEqual(result, new Uint8Array(0));
  });

  it('handles uppercase hex', () => {
    const result = hexToBytes('DEADBEEF');
    assert.deepEqual(result, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('throws on non-string input', () => {
    assert.throws(() => hexToBytes(123 as any), /must be a string/);
  });

  it('throws on odd-length hex', () => {
    assert.throws(() => hexToBytes('abc'), /even length/);
  });

  it('throws on invalid hex chars', () => {
    assert.throws(() => hexToBytes('ghij'), /invalid hex/);
  });
});

describe('bytesToHex', () => {
  it('converts bytes to hex', () => {
    const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    assert.equal(bytesToHex(bytes), '48656c6c6f');
  });

  it('handles empty array', () => {
    assert.equal(bytesToHex(new Uint8Array(0)), '');
  });

  it('pads single digits', () => {
    const bytes = new Uint8Array([0x0a, 0x0b]);
    assert.equal(bytesToHex(bytes), '0a0b');
  });
});

describe('generateKeyPair', () => {
  it('generates valid keypair', () => {
    const { publicKey, secretKey } = generateKeyPair();
    assert.equal(publicKey.length, 32);
    assert.equal(secretKey.length, 32);
  });

  it('generates unique keypairs', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    assert.notDeepEqual(kp1.publicKey, kp2.publicKey);
    assert.notDeepEqual(kp1.secretKey, kp2.secretKey);
  });
});

describe('generateNonce', () => {
  it('generates 24-byte nonce', () => {
    const nonce = generateNonce();
    assert.equal(nonce.length, 24);
  });

  it('generates unique nonces', () => {
    const n1 = generateNonce();
    const n2 = generateNonce();
    assert.notDeepEqual(n1, n2);
  });
});

describe('getPublicKeyFromSecretKey', () => {
  it('derives correct public key', () => {
    const { publicKey, secretKey } = generateKeyPair();
    const derived = getPublicKeyFromSecretKey(secretKey);
    assert.deepEqual(derived, publicKey);
  });
});

describe('padMessage / unpadMessage', () => {
  it('pads short messages to minimum 32 bytes', () => {
    const msg = new Uint8Array([0x01, 0x02, 0x03]);
    const padded = padMessage(msg);
    assert.equal(padded.length, 32);
  });

  it('pads to block boundary for longer messages', () => {
    const msg = new Uint8Array(40);
    const padded = padMessage(msg);
    // Should pad to next 256-byte boundary or similar
    assert.ok(padded.length > msg.length);
  });

  it('round-trips correctly', () => {
    const original = new TextEncoder().encode('Hello, Threema!');
    const padded = padMessage(original);
    const unpadded = unpadMessage(padded);
    assert.deepEqual(unpadded, original);
  });

  it('throws on invalid padding', () => {
    const invalid = new Uint8Array([0x01, 0x02, 0x03, 0x00]);
    assert.throws(() => unpadMessage(invalid), /invalid/i);
  });
});

describe('encrypt / decrypt', () => {
  it('encrypts and decrypts text message', () => {
    const sender = generateKeyPair();
    const recipient = generateKeyPair();

    const { box, nonce } = encryptTextMessage(
      'Secret message',
      recipient.publicKey,
      sender.secretKey
    );

    const decrypted = decryptMessage(
      box,
      nonce,
      sender.publicKey,
      recipient.secretKey
    );

    assert.ok(decrypted);
    assert.equal(decrypted.text, 'Secret message');
  });

  it('returns null for wrong recipient key', () => {
    const sender = generateKeyPair();
    const recipient = generateKeyPair();
    const wrongRecipient = generateKeyPair();

    const { box, nonce } = encryptTextMessage(
      'Test',
      recipient.publicKey,
      sender.secretKey
    );

    const decrypted = decryptMessage(
      box,
      nonce,
      sender.publicKey,
      wrongRecipient.secretKey
    );

    assert.equal(decrypted, null);
  });

  it('returns null for tampered ciphertext', () => {
    const sender = generateKeyPair();
    const recipient = generateKeyPair();

    const { box, nonce } = encryptTextMessage(
      'Test',
      recipient.publicKey,
      sender.secretKey
    );

    // Tamper with ciphertext
    box[0] ^= 0xff;

    const decrypted = decryptMessage(
      box,
      nonce,
      sender.publicKey,
      recipient.secretKey
    );

    assert.equal(decrypted, null);
  });
});

describe('webhook MAC', () => {
  it('computes deterministic MAC', async () => {
    const mac1 = await computeWebhookMac(
      'secret123',
      '*MYID123',
      'TARGETID',
      'msg1',
      '2024-01-01',
      'nonce123',
      'boxdata'
    );
    const mac2 = await computeWebhookMac(
      'secret123',
      '*MYID123',
      'TARGETID',
      'msg1',
      '2024-01-01',
      'nonce123',
      'boxdata'
    );
    assert.equal(mac1, mac2);
  });

  it('verifies valid MAC', async () => {
    const mac = await computeWebhookMac(
      'secret123',
      '*MYID123',
      'TARGETID',
      'msg1',
      '2024-01-01',
      'nonce123',
      'boxdata'
    );
    const valid = await verifyWebhookMac(
      'secret123',
      '*MYID123',
      'TARGETID',
      'msg1',
      '2024-01-01',
      'nonce123',
      'boxdata',
      mac
    );
    assert.equal(valid, true);
  });

  it('rejects invalid MAC', async () => {
    const valid = await verifyWebhookMac(
      'secret123',
      '*MYID123',
      'TARGETID',
      'msg1',
      '2024-01-01',
      'nonce123',
      'boxdata',
      'wrongmac'
    );
    assert.equal(valid, false);
  });

  it('handles case-insensitive MAC comparison', async () => {
    const mac = await computeWebhookMac(
      'secret123',
      '*MYID123',
      'TARGETID',
      'msg1',
      '2024-01-01',
      'nonce123',
      'boxdata'
    );
    const valid = await verifyWebhookMac(
      'secret123',
      '*MYID123',
      'TARGETID',
      'msg1',
      '2024-01-01',
      'nonce123',
      'boxdata',
      mac.toUpperCase()
    );
    assert.equal(valid, true);
  });
});
