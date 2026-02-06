/**
 * OpenClaw Threema Gateway Channel Plugin
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import * as threemaModule from './src/index.js';

// Create the channel plugin object
const channelPlugin = {
  id: threemaModule.CHANNEL_ID,
  meta: threemaModule.meta,
  capabilities: threemaModule.capabilities,
  defaults: threemaModule.defaults,
  config: {
    resolve: threemaModule.resolveAccount,
    listAccountIds: threemaModule.listAccountIds,
    isEnabled: threemaModule.isEnabled,
    isConfigured: threemaModule.isConfigured,
  },
  outbound: {
    send: async (params: any) => {
      const result = await threemaModule.sendText(params);
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      return { ok: true, messageId: result.messageId };
    },
  },
  gateway: {
    http: threemaModule.createWebhookHandler,
  },
};

const plugin = {
  id: "threema",
  name: "Threema Gateway",
  description: "Privacy-focused messaging via Threema Gateway with E2E encryption",
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" as const },
      apiId: { type: "string" as const },
      apiSecret: { type: "string" as const },
      privateKey: { type: "string" as const },
      mode: { type: "string" as const, enum: ["e2e", "basic"] },
      webhookPath: { type: "string" as const },
      dmPolicy: { type: "string" as const, enum: ["open", "pairing", "allowlist"] },
      allowFrom: { type: "array" as const, items: { type: "string" as const } },
    },
  },
  register(api: OpenClawPluginApi) {
    api.registerChannel({ plugin: channelPlugin as any });
  },
};

export default plugin;
