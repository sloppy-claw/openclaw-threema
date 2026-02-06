/**
 * OpenClaw Threema Gateway Channel Plugin
 *
 * Enables messaging via Threema Gateway with E2E encryption support.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type ThreemaConfig,
  type ThreemaAccount,
  type GatewayId,
  type ThreemaId,
  type ChannelCapabilities,
  type ChannelMeta,
  MessageLimits,
} from './types.js';
import { hexToBytes, getPublicKeyFromSecretKey } from './crypto.js';
import { sendMessage, sendE2EMessageCached } from './send.js';
import { createWebhookHandler, type IncomingMessage_ } from './receive.js';
import {
  lookup,
  lookupByPhone,
  lookupByEmail,
  getPublicKey,
  checkCredits,
} from './lookup.js';

// Re-export modules for external use
export * from './types.js';
export * from './crypto.js';
export * from './send.js';
export * from './receive.js';
export * from './lookup.js';

/**
 * Plugin ID
 */
export const CHANNEL_ID = 'threema' as const;

/**
 * Plugin metadata
 */
export const meta: ChannelMeta = {
  name: 'Threema',
  description: 'Privacy-focused messaging via Threema Gateway',
  icon: '🔒',
};

/**
 * Plugin capabilities
 */
export const capabilities: ChannelCapabilities = {
  chatTypes: ['direct'],
  reactions: false,
  threads: false,
  media: false, // Text-only for now
  nativeCommands: false,
  blockStreaming: true, // Threema doesn't support streaming
};

/**
 * Default configuration values
 */
export const defaults = {
  webhookPath: '/threema-webhook',
  dmPolicy: 'pairing' as const,
  mode: 'e2e' as const,
};

/**
 * OpenClaw config type (minimal subset needed)
 */
interface OpenClawConfig {
  channels?: {
    threema?: {
      enabled?: boolean;
      accounts?: Record<string, ThreemaConfig>;
    } & ThreemaConfig;
  };
}

/**
 * Resolve account from OpenClaw config
 */
export function resolveAccount(
  cfg: OpenClawConfig,
  accountId?: string | null
): ThreemaAccount | null {
  const threemaConfig = cfg.channels?.threema;
  if (!threemaConfig) return null;

  // Support both single account (direct config) and multi-account (accounts object)
  let config: ThreemaConfig | undefined;

  if (accountId && threemaConfig.accounts?.[accountId]) {
    config = threemaConfig.accounts[accountId];
  } else if (threemaConfig.apiId) {
    // Direct config (single account mode)
    config = threemaConfig as ThreemaConfig;
  } else if (threemaConfig.accounts) {
    // Multi-account: get first or default
    const accounts = threemaConfig.accounts;
    const id = accountId || 'default';
    config = accounts[id] || Object.values(accounts)[0];
  }

  if (!config || !config.apiId || !config.apiSecret) {
    return null;
  }

  let privateKey: Uint8Array;
  let publicKey: Uint8Array;

  if (config.privateKey) {
    try {
      privateKey = hexToBytes(config.privateKey);
      if (privateKey.length !== 32) {
        throw new Error(`privateKey must be 32 bytes (64 hex chars), got ${privateKey.length} bytes`);
      }
      publicKey = getPublicKeyFromSecretKey(privateKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid private key';
      throw new Error(`Invalid Threema privateKey: ${message}`);
    }
  } else {
    privateKey = new Uint8Array(32);
    publicKey = new Uint8Array(32);
  }

  return {
    id: config.apiId,
    secret: config.apiSecret,
    privateKey,
    publicKey,
    mode: config.mode || defaults.mode,
    webhookPath: config.webhookPath || defaults.webhookPath,
    dmPolicy: config.dmPolicy || defaults.dmPolicy,
    allowFrom: config.allowFrom || [],
  };
}

/**
 * List configured account IDs
 */
export function listAccountIds(cfg: OpenClawConfig): string[] {
  const threemaConfig = cfg.channels?.threema;
  if (!threemaConfig) return [];

  if (threemaConfig.accounts) {
    return Object.keys(threemaConfig.accounts);
  }

  // Single account mode
  if (threemaConfig.apiId) {
    return ['default'];
  }

  return [];
}

/**
 * Check if account is enabled
 */
export function isEnabled(account: ThreemaAccount): boolean {
  return true; // Account existence implies enabled
}

/**
 * Check if account is configured (has credentials)
 */
export function isConfigured(account: ThreemaAccount | null): boolean {
  if (!account) return false;
  return !!account.id && !!account.secret;
}

/**
 * Validate Threema ID format (8 alphanumeric characters)
 */
export function isValidThreemaId(id: string): boolean {
  return /^[A-Z0-9*]{8}$/i.test(id);
}

/**
 * Normalize Threema ID (uppercase)
 */
export function normalizeThreemaId(id: string): ThreemaId {
  return id.toUpperCase() as ThreemaId;
}

/**
 * Resolve target for outbound messages
 */
export function resolveTarget(
  to: string | undefined,
  allowFrom?: string[]
): { ok: true; to: ThreemaId } | { ok: false; error: Error } {
  if (!to) {
    return { ok: false, error: new Error('No recipient specified') };
  }

  const normalized = normalizeThreemaId(to);

  if (!isValidThreemaId(normalized)) {
    return {
      ok: false,
      error: new Error(`Invalid Threema ID: ${to}. Must be 8 alphanumeric characters.`),
    };
  }

  // Check allowlist if provided
  if (allowFrom && allowFrom.length > 0) {
    const normalizedAllowFrom = allowFrom.map((id) => normalizeThreemaId(id));
    if (!normalizedAllowFrom.includes(normalized)) {
      return {
        ok: false,
        error: new Error(`Recipient ${normalized} not in allowlist`),
      };
    }
  }

  return { ok: true, to: normalized };
}

/**
 * Send text message
 */
export async function sendText(params: {
  cfg: OpenClawConfig;
  to: string;
  text: string;
  accountId?: string | null;
}): Promise<{ messageId: string }> {
  const { cfg, to, text, accountId } = params;

  const account = resolveAccount(cfg, accountId);
  if (!account) {
    throw new Error('Threema account not configured');
  }

  const target = resolveTarget(to);
  if (!target.ok) {
    throw target.error;
  }

  // Use cached send for E2E mode
  if (account.mode === 'e2e') {
    return sendE2EMessageCached(target.to, text, account);
  }

  return sendMessage(target.to, text, account);
}

/**
 * Outbound adapter for OpenClaw
 */
export const outbound = {
  deliveryMode: 'direct' as const,
  textChunkLimit: MessageLimits.TEXT_MAX_BYTES,

  resolveTarget: (params: { to?: string; allowFrom?: string[] }) => {
    return resolveTarget(params.to, params.allowFrom);
  },

  sendText: async (ctx: {
    cfg: OpenClawConfig;
    to: string;
    text: string;
    accountId?: string | null;
  }) => {
    return sendText(ctx);
  },
};

/**
 * Config adapter for OpenClaw
 */
export const config = {
  listAccountIds,

  resolveAccount,

  isEnabled: (account: ThreemaAccount) => isEnabled(account),

  isConfigured: (account: ThreemaAccount | null) => isConfigured(account),

  resolveAllowFrom: (params: { cfg: OpenClawConfig; accountId?: string | null }) => {
    const account = resolveAccount(params.cfg, params.accountId);
    return account?.allowFrom;
  },
};

/**
 * Pairing adapter for DM allowlist
 */
export const pairing = {
  idLabel: 'Threema ID',

  normalizeAllowEntry: (entry: string) => normalizeThreemaId(entry),

  validateId: (id: string) => isValidThreemaId(id),
};

/**
 * Gateway adapter context type
 */
interface GatewayContext {
  cfg: OpenClawConfig;
  accountId: string;
  account: ThreemaAccount;
  abortSignal: AbortSignal;
  log?: (level: string, message: string, data?: unknown) => void;
  registerRoute?: (path: string, handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) => void;
  onInboundMessage?: (message: {
    from: string;
    to: string;
    text: string;
    messageId: string;
    timestamp: Date;
  }) => void | Promise<void>;
}

/**
 * Gateway adapter for OpenClaw (webhook registration)
 */
export const gateway = {
  /**
   * Start account - register webhook handler
   */
  startAccount: async (ctx: GatewayContext): Promise<void> => {
    const { account, log, registerRoute, onInboundMessage } = ctx;

    if (account.mode !== 'e2e') {
      log?.('warn', 'Basic mode does not support incoming messages');
      return;
    }

    if (!registerRoute) {
      log?.('warn', 'No route registration function provided');
      return;
    }

    if (!onInboundMessage) {
      log?.('warn', 'No inbound message handler provided');
      return;
    }

    // Create webhook handler
    const handler = createWebhookHandler({
      account,
      onMessage: async (message: IncomingMessage_) => {
        if (message.text) {
          await onInboundMessage({
            from: message.from,
            to: message.to,
            text: message.text,
            messageId: message.messageId,
            timestamp: message.timestamp,
          });
        }
      },
      log: (level, message, data) => log?.(level, message, data),
    });

    // Register webhook route
    registerRoute(account.webhookPath, handler);

    log?.('info', `Registered Threema webhook at ${account.webhookPath}`);
  },

  /**
   * Stop account - cleanup (no-op for webhooks)
   */
  stopAccount: async (): Promise<void> => {
    // Webhook handlers are cleaned up by the HTTP server
  },
};

/**
 * Status adapter for health checks
 */
export const status = {
  /**
   * Probe account health by checking credits
   */
  probeAccount: async (params: {
    account: ThreemaAccount;
    timeoutMs?: number;
  }): Promise<{ credits: number; healthy: boolean }> => {
    try {
      const credits = await checkCredits({
        apiId: params.account.id,
        apiSecret: params.account.secret,
      });

      return {
        credits,
        healthy: credits > 0,
      };
    } catch {
      return {
        credits: 0,
        healthy: false,
      };
    }
  },
};

/**
 * Directory adapter for lookups
 */
export const directory = {
  /**
   * Lookup user by phone or email
   */
  lookupUser: async (params: {
    cfg: OpenClawConfig;
    identifier: string;
    type: 'phone' | 'email' | 'id';
    accountId?: string | null;
  }) => {
    const account = resolveAccount(params.cfg, params.accountId);
    if (!account) {
      throw new Error('Threema account not configured');
    }

    const result = await lookup(params.identifier, params.type, {
      apiId: account.id,
      apiSecret: account.secret,
    });

    return result;
  },

  /**
   * Get public key for a Threema ID
   */
  getPublicKey: async (params: {
    cfg: OpenClawConfig;
    threemaId: string;
    accountId?: string | null;
  }) => {
    const account = resolveAccount(params.cfg, params.accountId);
    if (!account) {
      throw new Error('Threema account not configured');
    }

    return getPublicKey(params.threemaId, {
      apiId: account.id,
      apiSecret: account.secret,
    });
  },
};

/**
 * Complete Threema Channel Plugin for OpenClaw
 */
export const threemaPlugin = {
  id: CHANNEL_ID,
  meta,
  capabilities,
  defaults: {
    queue: {
      debounceMs: 100,
    },
  },
  reload: {
    configPrefixes: ['channels.threema'],
  },
  config,
  outbound,
  pairing,
  gateway,
  status,
  directory,
  gatewayMethods: ['POST'],
};

// Default export
export default threemaPlugin;
