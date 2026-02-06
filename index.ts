/**
 * OpenClaw Threema Channel Plugin (Personal Account Mode)
 *
 * Uses go-threema via a bridge binary for personal account messaging.
 * No Gateway API costs - just a one-time CHF 6 Threema license.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { spawn, ChildProcess } from "child_process";
import { createInterface, Interface } from "readline";
import { join, dirname } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// JSON protocol types
interface BridgeCommand {
  cmd: "connect" | "send" | "trust" | "ping";
  backup?: string;
  password?: string;
  to?: string;
  pubkey?: string;
  text?: string;
}

interface BridgeEvent {
  event: "connected" | "message" | "error" | "pong";
  id?: string;
  from?: string;
  nick?: string;
  time?: string;
  text?: string;
  error?: string;
}

// Config schema for personal mode
interface ThreemaPersonalConfig {
  enabled?: boolean;
  backup: string;      // 80-char exported identity backup
  password: string;    // Backup decryption password
  contacts?: Record<string, string>;  // Threema ID -> base64 pubkey
  dmPolicy?: "open" | "pairing" | "allowlist";
  allowFrom?: string[];
}

// Plugin state
let bridge: ChildProcess | null = null;
let bridgeReader: Interface | null = null;
let api: OpenClawPluginApi | null = null;
let ownId: string | null = null;
const pendingMessages: Map<string, (err?: Error) => void> = new Map();

// Find the bridge binary
function findBridgeBinary(): string {
  const candidates = [
    join(__dirname, "threema-bridge"),
    join(__dirname, "bin", "threema-bridge"),
    join(__dirname, "bin", `threema-bridge-${process.platform}-${process.arch}`),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
    // Try with .exe on Windows
    if (process.platform === "win32" && existsSync(candidate + ".exe")) {
      return candidate + ".exe";
    }
  }

  throw new Error(`threema-bridge binary not found. Tried: ${candidates.join(", ")}`);
}

// Send command to bridge
function sendCommand(cmd: BridgeCommand): void {
  if (!bridge || !bridge.stdin) {
    throw new Error("Bridge not running");
  }
  bridge.stdin.write(JSON.stringify(cmd) + "\n");
}

// Handle events from bridge
function handleEvent(event: BridgeEvent): void {
  switch (event.event) {
    case "connected":
      ownId = event.id || null;
      console.log(`[threema] Connected as ${ownId}`);
      break;

    case "message":
      if (api && event.from && event.text) {
        // Route message to OpenClaw
        api.runtime.inbound?.({
          channel: "threema",
          from: event.from,
          text: event.text,
          timestamp: event.time ? new Date(event.time) : new Date(),
          meta: { nick: event.nick },
        });
      }
      break;

    case "error":
      console.error(`[threema] Error: ${event.error}`);
      break;

    case "pong":
      // Health check response
      break;
  }
}

// Start the bridge process
async function startBridge(config: ThreemaPersonalConfig): Promise<void> {
  const binaryPath = findBridgeBinary();
  console.log(`[threema] Starting bridge: ${binaryPath}`);

  bridge = spawn(binaryPath, [], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  bridge.stderr?.on("data", (data) => {
    console.error(`[threema-bridge] ${data.toString().trim()}`);
  });

  bridge.on("error", (err) => {
    console.error(`[threema] Bridge error: ${err.message}`);
    bridge = null;
  });

  bridge.on("exit", (code) => {
    console.log(`[threema] Bridge exited with code ${code}`);
    bridge = null;
    bridgeReader = null;
  });

  // Set up event reader
  bridgeReader = createInterface({
    input: bridge.stdout!,
    crlfDelay: Infinity,
  });

  bridgeReader.on("line", (line) => {
    try {
      const event = JSON.parse(line) as BridgeEvent;
      handleEvent(event);
    } catch (err) {
      console.error(`[threema] Failed to parse event: ${line}`);
    }
  });

  // Connect with credentials
  sendCommand({
    cmd: "connect",
    backup: config.backup,
    password: config.password,
  });

  // Trust configured contacts
  if (config.contacts) {
    for (const [id, pubkey] of Object.entries(config.contacts)) {
      sendCommand({
        cmd: "trust",
        to: id,
        pubkey: pubkey,
      });
    }
  }

  // Wait a moment for connection
  await new Promise((r) => setTimeout(r, 2000));
}

// Stop the bridge
function stopBridge(): void {
  if (bridge) {
    bridge.kill("SIGTERM");
    bridge = null;
    bridgeReader = null;
  }
}

// Channel plugin object
const channelPlugin = {
  id: "threema" as const,
  meta: {
    name: "Threema",
    description: "Privacy-focused messaging via personal Threema account",
    icon: "🔒",
  },
  capabilities: {
    chatTypes: ["direct" as const],
    reactions: false,
    threads: false,
    media: false, // Text only for now
    nativeCommands: false,
    blockStreaming: true,
  },
  defaults: {
    dmPolicy: "pairing" as const,
  },
  config: {
    resolve: (cfg: any) => {
      const config = cfg.channels?.threema as ThreemaPersonalConfig | undefined;
      if (!config?.backup || !config?.password) return null;
      return config;
    },
    listAccountIds: () => ["default"],
    isEnabled: () => bridge !== null,
    isConfigured: (cfg: ThreemaPersonalConfig | null) =>
      cfg !== null && !!cfg.backup && !!cfg.password,
  },
  outbound: {
    send: async (params: { to: string; text: string; pubkey?: string }) => {
      if (!bridge) {
        return { ok: false, error: new Error("Not connected") };
      }
      try {
        sendCommand({
          cmd: "send",
          to: params.to,
          text: params.text,
          pubkey: params.pubkey,
        });
        return { ok: true, messageId: `threema-${Date.now()}` };
      } catch (err) {
        return { ok: false, error: err as Error };
      }
    },
  },
};

// Plugin definition
const plugin = {
  id: "threema",
  name: "Threema Personal",
  version: "0.2.0",
  description: "Privacy-focused messaging via personal Threema account (go-threema)",
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" as const },
      backup: {
        type: "string" as const,
        description: "80-char exported identity backup (XXXX-XXXX-...)",
      },
      password: {
        type: "string" as const,
        description: "Backup decryption password",
      },
      contacts: {
        type: "object" as const,
        additionalProperties: { type: "string" as const },
        description: "Map of Threema ID to base64 public key",
      },
      dmPolicy: {
        type: "string" as const,
        enum: ["open", "pairing", "allowlist"],
        default: "pairing",
      },
      allowFrom: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "Allowed Threema IDs (for allowlist policy)",
      },
    },
  },

  async activate(pluginApi: OpenClawPluginApi) {
    api = pluginApi;
    const config = pluginApi.config.channels?.threema as ThreemaPersonalConfig | undefined;

    if (config?.backup && config?.password) {
      try {
        await startBridge(config);
      } catch (err) {
        console.error(`[threema] Failed to start bridge: ${err}`);
      }
    }
  },

  deactivate() {
    stopBridge();
    api = null;
  },

  register(pluginApi: OpenClawPluginApi) {
    pluginApi.registerChannel({ plugin: channelPlugin as any });
  },
};

export default plugin;
