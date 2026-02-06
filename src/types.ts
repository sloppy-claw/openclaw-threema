/**
 * Threema Gateway Plugin Types
 */

// Threema ID is always 8 characters
export type ThreemaId = string;

// Gateway API identity starts with *
export type GatewayId = `*${string}`;

/**
 * Plugin configuration
 */
export interface ThreemaConfig {
  enabled: boolean;
  apiId: GatewayId;
  apiSecret: string;
  privateKey: string; // NaCl private key (hex, 64 chars = 32 bytes)
  mode: 'basic' | 'e2e';
  webhookPath?: string;
  dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
  allowFrom?: ThreemaId[];
}

/**
 * Resolved account from config
 */
export interface ThreemaAccount {
  id: GatewayId;
  secret: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  mode: 'basic' | 'e2e';
  webhookPath: string;
  dmPolicy: 'pairing' | 'allowlist' | 'open' | 'disabled';
  allowFrom: ThreemaId[];
}

/**
 * Threema message types (type byte in encrypted box)
 */
export enum MessageType {
  Text = 0x01,
  Image = 0x02,
  Location = 0x03,
  Video = 0x10,
  Audio = 0x12,
  File = 0x17,
  DeliveryReceipt = 0x80,
  TypingIndicator = 0x81,
}

/**
 * Incoming webhook payload from Threema Gateway
 */
export interface IncomingWebhookPayload {
  from: ThreemaId;
  to: GatewayId;
  messageId: string;
  date: string; // Unix timestamp
  nonce: string; // 24 bytes hex
  box: string; // Encrypted message hex
  mac: string; // HMAC-SHA256 for verification
}

/**
 * Decrypted message content
 */
export interface DecryptedMessage {
  type: MessageType;
  text?: string;
  raw: Uint8Array;
}

/**
 * Lookup result
 */
export interface LookupResult {
  id: ThreemaId;
  publicKey?: string; // hex
}

/**
 * Send message options
 */
export interface SendOptions {
  noDeliveryReceipts?: boolean;
  noPush?: boolean;
}

/**
 * Send result
 */
export interface SendResult {
  messageId: string;
}

/**
 * API error response
 */
export interface ApiError {
  status: number;
  message: string;
}

/**
 * Threema Gateway API status codes
 */
export const ApiStatusCodes = {
  200: 'Success',
  400: 'Invalid request or recipient',
  401: 'Authentication failed',
  402: 'No credits remaining',
  404: 'Recipient not found',
  413: 'Message too long',
  429: 'Rate limited',
  500: 'Server error',
} as const;

/**
 * Message limits
 */
export const MessageLimits = {
  TEXT_MAX_BYTES: 3500,
  ENCRYPTED_BOX_MAX_BYTES: 7812,
  PADDING_BLOCK_SIZE: 256,
} as const;

/**
 * API base URL
 */
export const API_BASE_URL = 'https://msgapi.threema.ch';

/**
 * OpenClaw channel types (subset needed for plugin)
 */
export type ChatType = 'direct' | 'group' | 'channel' | 'thread';

export interface ChannelCapabilities {
  chatTypes: ChatType[];
  reactions?: boolean;
  threads?: boolean;
  media?: boolean;
  nativeCommands?: boolean;
  blockStreaming?: boolean;
}

export interface ChannelMeta {
  name: string;
  description?: string;
  icon?: string;
}

/**
 * External reference for OpenClaw
 */
export interface ThreemaExternalRef {
  channelId: 'threema';
  chatType: 'direct';
  chatId: ThreemaId;
  accountId: GatewayId;
}

/**
 * Outbound message from OpenClaw
 */
export interface OutboundMessage {
  text?: string;
  media?: {
    type: string;
    url: string;
    caption?: string;
  };
}
