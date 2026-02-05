# OpenClaw Channel Plugin Types Reference

From `/usr/lib/node_modules/openclaw/dist/channels/plugins/types.plugin.d.ts`:

```typescript
export type ChannelPlugin<ResolvedAccount = any> = {
    id: ChannelId;
    meta: ChannelMeta;
    capabilities: ChannelCapabilities;
    defaults?: {
        queue?: {
            debounceMs?: number;
        };
    };
    reload?: {
        configPrefixes: string[];
        noopPrefixes?: string[];
    };
    onboarding?: ChannelOnboardingAdapter;
    config: ChannelConfigAdapter<ResolvedAccount>;
    configSchema?: ChannelConfigSchema;
    setup?: ChannelSetupAdapter;
    pairing?: ChannelPairingAdapter;
    security?: ChannelSecurityAdapter<ResolvedAccount>;
    groups?: ChannelGroupAdapter;
    mentions?: ChannelMentionAdapter;
    outbound?: ChannelOutboundAdapter;
    status?: ChannelStatusAdapter<ResolvedAccount>;
    gatewayMethods?: string[];
    gateway?: ChannelGatewayAdapter<ResolvedAccount>;
    auth?: ChannelAuthAdapter;
    elevated?: ChannelElevatedAdapter;
    commands?: ChannelCommandAdapter;
    streaming?: ChannelStreamingAdapter;
    threading?: ChannelThreadingAdapter;
    messaging?: ChannelMessagingAdapter;
    agentPrompt?: ChannelAgentPromptAdapter;
    directory?: ChannelDirectoryAdapter;
    resolver?: ChannelResolverAdapter;
    actions?: ChannelMessageActionAdapter;
    heartbeat?: ChannelHeartbeatAdapter;
    agentTools?: ChannelAgentToolFactory | ChannelAgentTool[];
};
```

## Capabilities Structure

```typescript
export type ChannelCapabilities = {
    chatTypes: ChatType[];  // "direct" | "group" | "channel" | "thread"
    reactions?: boolean;
    threads?: boolean;
    media?: boolean;
    nativeCommands?: boolean;
    blockStreaming?: boolean;
};
```

## Key Adapters

### ChannelConfigAdapter
Manages account configuration, listing, resolving.

### ChannelPairingAdapter
Handles pairing flow for new users.

### ChannelSecurityAdapter
DM policies, allowlists, security warnings.

### ChannelOutboundAdapter
Sends messages (probe, send, typing indicators).

### ChannelGatewayAdapter
Webhook handlers for incoming messages.

## Reference Plugins

- `/usr/lib/node_modules/openclaw/dist/channels/plugins/telegram.js`
- `/usr/lib/node_modules/openclaw/dist/channels/plugins/signal.js`
- `/usr/lib/node_modules/openclaw/dist/channels/plugins/bluebubbles-actions.js`
