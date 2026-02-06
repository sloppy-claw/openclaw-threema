/**
 * Threema Gateway Lookup API
 *
 * Resolve phone numbers, emails, and Threema IDs to get public keys.
 */

import { API_BASE_URL, type ThreemaId, type GatewayId, type LookupResult } from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

interface LookupOptions {
  apiId: GatewayId;
  apiSecret: string;
}

async function apiRequest(
  endpoint: string,
  options: LookupOptions
): Promise<Response> {
  const url = new URL(endpoint, API_BASE_URL);
  url.searchParams.set('from', options.apiId);
  url.searchParams.set('secret', options.apiSecret);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Accept': 'text/plain',
    },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  return response;
}

/**
 * Handle API response
 */
async function handleResponse(response: Response): Promise<string | null> {
  if (response.status === 404) {
    return null; // Not found
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Threema API error ${response.status}: ${text}`);
  }

  return response.text();
}

/**
 * Lookup Threema ID by phone number (E.164 format without +)
 *
 * @param phone - Phone number in E.164 format without + (e.g., "41791234567")
 * @param options - API credentials
 * @returns Threema ID or null if not found
 */
export async function lookupByPhone(
  phone: string,
  options: LookupOptions
): Promise<ThreemaId | null> {
  // Normalize phone: remove any + prefix and spaces
  const normalized = phone.replace(/[^0-9]/g, '');

  const response = await apiRequest(`/lookup/phone/${normalized}`, options);
  const result = await handleResponse(response);

  return result ? (result.trim() as ThreemaId) : null;
}

/**
 * Lookup Threema ID by email address
 *
 * @param email - Email address
 * @param options - API credentials
 * @returns Threema ID or null if not found
 */
export async function lookupByEmail(
  email: string,
  options: LookupOptions
): Promise<ThreemaId | null> {
  // Normalize email to lowercase
  const normalized = email.toLowerCase().trim();

  const response = await apiRequest(`/lookup/email/${encodeURIComponent(normalized)}`, options);
  const result = await handleResponse(response);

  return result ? (result.trim() as ThreemaId) : null;
}

/**
 * Lookup Threema ID by email hash (SHA256 of lowercase email)
 *
 * @param emailHash - SHA256 hash of lowercase email (64 hex chars)
 * @param options - API credentials
 * @returns Threema ID or null if not found
 */
export async function lookupByEmailHash(
  emailHash: string,
  options: LookupOptions
): Promise<ThreemaId | null> {
  const response = await apiRequest(`/lookup/email_hash/${emailHash.toLowerCase()}`, options);
  const result = await handleResponse(response);

  return result ? (result.trim() as ThreemaId) : null;
}

/**
 * Verify a Threema ID exists
 *
 * @param threemaId - Threema ID to verify (8 characters)
 * @param options - API credentials
 * @returns true if ID exists, false otherwise
 */
export async function verifyId(
  threemaId: ThreemaId,
  options: LookupOptions
): Promise<boolean> {
  const response = await apiRequest(`/lookup/id/${threemaId.toUpperCase()}`, options);
  return response.ok;
}

/**
 * Get public key for a Threema ID
 *
 * @param threemaId - Threema ID (8 characters)
 * @param options - API credentials
 * @returns Public key as hex string (64 chars = 32 bytes) or null if not found
 */
export async function getPublicKey(
  threemaId: ThreemaId,
  options: LookupOptions
): Promise<string | null> {
  const response = await apiRequest(`/pubkeys/${threemaId.toUpperCase()}`, options);
  const result = await handleResponse(response);

  return result ? result.trim() : null;
}

/**
 * Get capabilities of a Threema ID
 *
 * @param threemaId - Threema ID (8 characters)
 * @param options - API credentials
 * @returns Comma-separated capabilities or null if not found
 */
export async function getCapabilities(
  threemaId: ThreemaId,
  options: LookupOptions
): Promise<string[] | null> {
  const response = await apiRequest(`/capabilities/${threemaId.toUpperCase()}`, options);
  const result = await handleResponse(response);

  if (!result) return null;

  return result.trim().split(',').filter(Boolean);
}

/**
 * Check remaining API credits
 *
 * @param options - API credentials
 * @returns Number of remaining credits
 */
export async function checkCredits(options: LookupOptions): Promise<number> {
  const response = await apiRequest('/credits', options);
  const result = await handleResponse(response);

  if (!result) {
    throw new Error('Failed to get credits');
  }

  return parseInt(result.trim(), 10);
}

/**
 * Lookup with full result including public key
 *
 * @param identifier - Phone, email, or Threema ID
 * @param type - Type of identifier
 * @param options - API credentials
 * @returns Lookup result with ID and public key, or null if not found
 */
export async function lookup(
  identifier: string,
  type: 'phone' | 'email' | 'id',
  options: LookupOptions
): Promise<LookupResult | null> {
  let threemaId: ThreemaId | null = null;

  switch (type) {
    case 'phone':
      threemaId = await lookupByPhone(identifier, options);
      break;
    case 'email':
      threemaId = await lookupByEmail(identifier, options);
      break;
    case 'id':
      const exists = await verifyId(identifier as ThreemaId, options);
      if (exists) {
        threemaId = identifier.toUpperCase() as ThreemaId;
      }
      break;
  }

  if (!threemaId) {
    return null;
  }

  const publicKey = await getPublicKey(threemaId, options);

  return {
    id: threemaId,
    publicKey: publicKey ?? undefined,
  };
}
