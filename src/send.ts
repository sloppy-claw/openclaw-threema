/**
 * Threema Gateway Send Message API
 *
 * Supports both Basic (server-side encryption) and E2E modes.
 */

import {
  API_BASE_URL,
  type ThreemaId,
  type GatewayId,
  type ThreemaAccount,
  type SendOptions,
  type SendResult,
} from './types.js';
import { encryptTextMessage, bytesToHex, hexToBytes } from './crypto.js';
import { getPublicKey } from './lookup.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CACHE_SIZE = 1000;

/**
 * Send a text message using Basic mode (server-side encryption)
 *
 * Note: Basic mode does NOT support receiving messages.
 *
 * @param recipient - Can be Threema ID, phone (E.164), or email
 * @param recipientType - Type of recipient identifier
 * @param text - Message text (max 3500 bytes UTF-8)
 * @param account - Threema account credentials
 * @param options - Send options
 */
export async function sendBasicMessage(
  recipient: string,
  recipientType: 'id' | 'phone' | 'email',
  text: string,
  account: ThreemaAccount,
  options: SendOptions = {}
): Promise<SendResult> {
  const url = new URL('/send_simple', API_BASE_URL);

  const params = new URLSearchParams();
  params.set('from', account.id);
  params.set('secret', account.secret);
  params.set('text', text);

  // Set recipient based on type
  switch (recipientType) {
    case 'id':
      params.set('to', recipient.toUpperCase());
      break;
    case 'phone':
      params.set('phone', recipient.replace(/[^0-9]/g, ''));
      break;
    case 'email':
      params.set('email', recipient.toLowerCase());
      break;
  }

  if (options.noDeliveryReceipts) {
    params.set('noDeliveryReceipts', '1');
  }
  if (options.noPush) {
    params.set('noPush', '1');
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Threema send_simple failed (${response.status}): ${errorText}`);
  }

  const messageId = await response.text();
  return { messageId: messageId.trim() };
}

/**
 * Send a text message using E2E mode (end-to-end encryption)
 *
 * @param recipientId - Threema ID (8 characters)
 * @param text - Message text (max 3500 bytes UTF-8)
 * @param account - Threema account with private key
 * @param options - Send options
 * @param recipientPublicKey - Optional: recipient's public key (fetched if not provided)
 */
export async function sendE2EMessage(
  recipientId: ThreemaId,
  text: string,
  account: ThreemaAccount,
  options: SendOptions = {},
  recipientPublicKey?: Uint8Array
): Promise<SendResult> {
  // Get recipient's public key if not provided
  let pubKey = recipientPublicKey;
  if (!pubKey) {
    const pubKeyHex = await getPublicKey(recipientId, {
      apiId: account.id,
      apiSecret: account.secret,
    });

    if (!pubKeyHex) {
      throw new Error(`Could not fetch public key for ${recipientId}`);
    }

    pubKey = hexToBytes(pubKeyHex);
  }

  // Encrypt the message
  const { nonce, box } = encryptTextMessage(text, pubKey, account.privateKey);

  // Send encrypted message
  const url = new URL('/send_e2e', API_BASE_URL);

  const params = new URLSearchParams();
  params.set('from', account.id);
  params.set('to', recipientId.toUpperCase());
  params.set('nonce', bytesToHex(nonce));
  params.set('box', bytesToHex(box));
  params.set('secret', account.secret);

  if (options.noDeliveryReceipts) {
    params.set('noDeliveryReceipts', '1');
  }
  if (options.noPush) {
    params.set('noPush', '1');
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Threema send_e2e failed (${response.status}): ${errorText}`);
  }

  const messageId = await response.text();
  return { messageId: messageId.trim() };
}

/**
 * Send a message using the appropriate mode based on account configuration
 *
 * @param recipientId - Threema ID (8 characters)
 * @param text - Message text
 * @param account - Threema account
 * @param options - Send options
 */
export async function sendMessage(
  recipientId: ThreemaId,
  text: string,
  account: ThreemaAccount,
  options: SendOptions = {}
): Promise<SendResult> {
  if (account.mode === 'e2e') {
    return sendE2EMessage(recipientId, text, account, options);
  } else {
    return sendBasicMessage(recipientId, 'id', text, account, options);
  }
}

const publicKeyCache = new Map<string, Uint8Array>();

function addToCache(cache: Map<string, Uint8Array>, key: string, value: Uint8Array): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }
  cache.set(key, value);
}

export async function sendE2EMessageCached(
  recipientId: ThreemaId,
  text: string,
  account: ThreemaAccount,
  options: SendOptions = {}
): Promise<SendResult> {
  const cacheKey = recipientId.toUpperCase();

  let pubKey = publicKeyCache.get(cacheKey);
  if (!pubKey) {
    const pubKeyHex = await getPublicKey(recipientId, {
      apiId: account.id,
      apiSecret: account.secret,
    });

    if (!pubKeyHex) {
      throw new Error(`Could not fetch public key for ${recipientId}`);
    }

    pubKey = hexToBytes(pubKeyHex);
    addToCache(publicKeyCache, cacheKey, pubKey);
  }

  return sendE2EMessage(recipientId, text, account, options, pubKey);
}

/**
 * Clear public key cache (useful when keys might have changed)
 */
export function clearPublicKeyCache(): void {
  publicKeyCache.clear();
}

/**
 * Remove a specific ID from the public key cache
 */
export function evictFromPublicKeyCache(threemaId: ThreemaId): void {
  publicKeyCache.delete(threemaId.toUpperCase());
}
