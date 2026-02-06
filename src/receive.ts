/**
 * Threema Gateway Webhook Handler
 *
 * Handles incoming messages from Threema Gateway callback URL.
 * E2E mode only - Basic mode does not support incoming messages.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type IncomingWebhookPayload,
  type ThreemaAccount,
  type DecryptedMessage,
  MessageType,
} from './types.js';
import { decryptMessage, verifyWebhookMac, hexToBytes } from './crypto.js';
import { getPublicKey } from './lookup.js';

const MAX_CACHE_SIZE = 1000;

/**
 * Parsed and decrypted incoming message
 */
export interface IncomingMessage_ {
  from: string;
  to: string;
  messageId: string;
  timestamp: Date;
  type: MessageType;
  text?: string;
  raw: Uint8Array;
}

/**
 * Webhook handler context
 */
export interface WebhookContext {
  account: ThreemaAccount;
  onMessage: (message: IncomingMessage_) => void | Promise<void>;
  log?: (level: 'info' | 'warn' | 'error', message: string, data?: unknown) => void;
}

const senderPublicKeyCache = new Map<string, Uint8Array>();

function addToSenderCache(key: string, value: Uint8Array): void {
  if (senderPublicKeyCache.size >= MAX_CACHE_SIZE) {
    const firstKey = senderPublicKeyCache.keys().next().value;
    if (firstKey !== undefined) {
      senderPublicKeyCache.delete(firstKey);
    }
  }
  senderPublicKeyCache.set(key, value);
}
async function parseUrlEncodedBody(req: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        const params = new URLSearchParams(body);
        const result: Record<string, string> = {};
        for (const [key, value] of params) {
          result[key] = value;
        }
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

/**
 * Validate incoming webhook payload structure
 */
function validatePayload(body: Record<string, string>): IncomingWebhookPayload {
  const required = ['from', 'to', 'messageId', 'date', 'nonce', 'box', 'mac'] as const;

  for (const field of required) {
    if (!body[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  return {
    from: body.from,
    to: body.to as `*${string}`,
    messageId: body.messageId,
    date: body.date,
    nonce: body.nonce,
    box: body.box,
    mac: body.mac,
  };
}

/**
 * Get sender public key (with caching)
 */
async function getSenderPublicKey(
  senderId: string,
  account: ThreemaAccount
): Promise<Uint8Array> {
  const cacheKey = senderId.toUpperCase();

  let pubKey = senderPublicKeyCache.get(cacheKey);
  if (!pubKey) {
    const pubKeyHex = await getPublicKey(senderId, {
      apiId: account.id,
      apiSecret: account.secret,
    });

    if (!pubKeyHex) {
      throw new Error(`Could not fetch public key for sender ${senderId}`);
    }

    pubKey = hexToBytes(pubKeyHex);
    addToSenderCache(cacheKey, pubKey);
  }

  return pubKey;
}

/**
 * Process incoming webhook from Threema Gateway
 */
export async function processWebhook(
  payload: IncomingWebhookPayload,
  ctx: WebhookContext
): Promise<void> {
  const { account, onMessage, log } = ctx;

  // Verify MAC
  const macValid = await verifyWebhookMac(
    account.secret,
    payload.from,
    payload.to,
    payload.messageId,
    payload.date,
    payload.nonce,
    payload.box,
    payload.mac
  );

  if (!macValid) {
    log?.('warn', 'MAC verification failed', { messageId: payload.messageId });
    throw new Error('MAC verification failed');
  }

  // Get sender's public key
  const senderPublicKey = await getSenderPublicKey(payload.from, account);

  // Decrypt message
  const nonce = hexToBytes(payload.nonce);
  const box = hexToBytes(payload.box);

  const decrypted = decryptMessage(box, nonce, senderPublicKey, account.privateKey);

  if (!decrypted) {
    log?.('error', 'Failed to decrypt message', { messageId: payload.messageId });
    throw new Error('Decryption failed');
  }

  // Build incoming message
  const message: IncomingMessage_ = {
    from: payload.from,
    to: payload.to,
    messageId: payload.messageId,
    timestamp: new Date(parseInt(payload.date, 10) * 1000),
    type: decrypted.type,
    text: decrypted.text,
    raw: decrypted.raw,
  };

  log?.('info', 'Received message', {
    from: message.from,
    messageId: message.messageId,
    type: MessageType[message.type] || message.type,
  });

  // Invoke callback
  await onMessage(message);
}

/**
 * Create HTTP webhook handler for Threema Gateway
 *
 * @param ctx - Webhook context with account and message handler
 * @returns HTTP request handler
 */
export function createWebhookHandler(
  ctx: WebhookContext
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const { log } = ctx;

    // Only accept POST
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    try {
      // Parse body
      const body = await parseUrlEncodedBody(req);

      // Validate payload
      const payload = validatePayload(body);

      // Process webhook
      await processWebhook(payload, ctx);

      // Success
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log?.('error', 'Webhook processing failed', { error: errorMessage });

      // Return 200 to prevent retries (Threema might retry on errors)
      // But log the error for debugging
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    }
  };
}

export function clearSenderKeyCache(): void {
  senderPublicKeyCache.clear();
}

export function evictSenderFromCache(senderId: string): void {
  senderPublicKeyCache.delete(senderId.toUpperCase());
}
