/**
 * OpenClaw plugin entry point for crawd.
 *
 * Registers:
 * - `livestream_talk` tool (unprompted speech on stream)
 * - `livestream_reply` tool (reply to a chat message)
 * - `livestream_notification` tool (big notification on stream)
 * - `crawd` service (Fastify + Socket.IO backend)
 */
import { Type } from '@sinclair/typebox'
import { CrawdBackend, type CrawdConfig, type TtsVoiceEntry } from './backend/server.js'

// Minimal plugin types — the real types come from openclaw/plugin-sdk at runtime.
// Defined inline so this package builds without the openclaw peerDep installed.
type PluginLogger = {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

type PluginApi = {
  pluginConfig?: Record<string, unknown>
  logger: PluginLogger
  registerTool: (tool: Record<string, unknown>, opts?: { name?: string }) => void
  registerService: (service: { id: string; start: () => Promise<void>; stop?: () => Promise<void> }) => void
}

type PluginDefinition = {
  id: string
  name: string
  description: string
  configSchema?: Record<string, unknown>
  register?: (api: PluginApi) => void | Promise<void>
}

// ---------------------------------------------------------------------------
// Config parsing — transform pluginConfig → CrawdConfig
// ---------------------------------------------------------------------------

function parseTtsChain(raw: unknown): TtsVoiceEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e): e is { provider: string; voice: string } =>
      e && typeof e === 'object' && typeof e.provider === 'string' && typeof e.voice === 'string',
    )
    .map((e) => ({
      provider: e.provider as TtsVoiceEntry['provider'],
      voice: e.voice,
    }))
}

function parsePluginConfig(raw: Record<string, unknown> | undefined): CrawdConfig {
  const cfg = raw ?? {}
  const tts = (cfg.tts ?? {}) as Record<string, unknown>
  const vibe = (cfg.vibe ?? {}) as Record<string, unknown>
  const chat = (cfg.chat ?? {}) as Record<string, unknown>
  const youtube = (chat.youtube ?? {}) as Record<string, unknown>
  const pumpfun = (chat.pumpfun ?? {}) as Record<string, unknown>

  const port = typeof cfg.port === 'number' ? cfg.port : 4000

  return {
    enabled: cfg.enabled !== false,
    port,
    bindHost: typeof cfg.bindHost === 'string' ? cfg.bindHost : '0.0.0.0',
    backendUrl: typeof cfg.backendUrl === 'string' ? cfg.backendUrl : `http://localhost:${port}`,
    tts: {
      chat: parseTtsChain(tts.chat),
      bot: parseTtsChain(tts.bot),
      openaiApiKey: typeof tts.openaiApiKey === 'string' ? tts.openaiApiKey : undefined,
      elevenlabsApiKey: typeof tts.elevenlabsApiKey === 'string' ? tts.elevenlabsApiKey : undefined,
      tiktokSessionId: typeof tts.tiktokSessionId === 'string' ? tts.tiktokSessionId : undefined,
    },
    vibe: {
      enabled: vibe.enabled !== false,
      intervalMs: typeof vibe.intervalMs === 'number' ? vibe.intervalMs : 10_000,
      idleAfterMs: typeof vibe.idleAfterMs === 'number' ? vibe.idleAfterMs : 30_000,
      sleepAfterIdleMs: typeof vibe.sleepAfterIdleMs === 'number' ? vibe.sleepAfterIdleMs : 60_000,
      prompt: typeof vibe.prompt === 'string' ? vibe.prompt : undefined,
    },
    chat: {
      youtube: {
        enabled: youtube.enabled === true,
        videoId: typeof youtube.videoId === 'string' ? youtube.videoId : undefined,
      },
      pumpfun: {
        enabled: pumpfun.enabled !== false,
        tokenMint: typeof pumpfun.tokenMint === 'string' ? pumpfun.tokenMint : undefined,
        authToken: typeof pumpfun.authToken === 'string' ? pumpfun.authToken : undefined,
      },
    },
    gatewayUrl: typeof cfg.gatewayUrl === 'string' ? cfg.gatewayUrl : undefined,
    gatewayToken: typeof cfg.gatewayToken === 'string' ? cfg.gatewayToken : undefined,
  }
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const crawdConfigSchema = {
  parse(value: unknown) {
    const raw = value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
    return parsePluginConfig(raw)
  },
  uiHints: {
    enabled: { label: 'Enabled' },
    port: { label: 'Backend Port', placeholder: '4000' },
    bindHost: { label: 'Bind Host', placeholder: '0.0.0.0', advanced: true },
    backendUrl: { label: 'Backend URL', advanced: true, help: 'Public URL for TTS file serving' },
    'tts.chat': { label: 'Chat TTS Voices', help: 'Ordered fallback chain [{provider, voice}]' },
    'tts.bot': { label: 'Bot TTS Voices', help: 'Ordered fallback chain [{provider, voice}]' },
    'tts.openaiApiKey': { label: 'OpenAI API Key', sensitive: true },
    'tts.elevenlabsApiKey': { label: 'ElevenLabs API Key', sensitive: true },
    'tts.tiktokSessionId': { label: 'TikTok Session ID', sensitive: true },
    'vibe.enabled': { label: 'Vibe Mode' },
    'vibe.intervalMs': { label: 'Vibe Interval (ms)', advanced: true },
    'vibe.idleAfterMs': { label: 'Idle After (ms)', advanced: true },
    'vibe.sleepAfterIdleMs': { label: 'Sleep After Idle (ms)', advanced: true },
    'vibe.prompt': { label: 'Vibe Prompt', advanced: true },
    'chat.youtube.enabled': { label: 'YouTube Chat' },
    'chat.youtube.videoId': { label: 'YouTube Video ID' },
    'chat.pumpfun.enabled': { label: 'PumpFun Chat' },
    'chat.pumpfun.tokenMint': { label: 'PumpFun Token Mint' },
    'chat.pumpfun.authToken': { label: 'PumpFun Auth Token', sensitive: true },
    gatewayUrl: { label: 'Gateway URL', advanced: true, help: 'WebSocket URL for agent triggering' },
    gatewayToken: { label: 'Gateway Token', sensitive: true },
  },
}

const plugin: PluginDefinition = {
  id: 'crawd',
  name: 'Crawd Livestream',
  description: 'AI agent livestreaming with TTS, chat integration, and OBS overlay',
  configSchema: crawdConfigSchema,

  register(api: PluginApi) {
    const config = parsePluginConfig(api.pluginConfig)
    if (!config.enabled) {
      api.logger.info('crawd: disabled')
      return
    }

    let backend: CrawdBackend | null = null
    let backendPromise: Promise<CrawdBackend> | null = null

    const ensureBackend = async (): Promise<CrawdBackend> => {
      if (backend) return backend
      if (!backendPromise) {
        backendPromise = (async () => {
          const b = new CrawdBackend(config, {
            info: (msg) => api.logger.info(`[crawd] ${msg}`),
            warn: (msg) => api.logger.warn(`[crawd] ${msg}`),
            error: (msg) => api.logger.error(`[crawd] ${msg}`),
          })
          await b.start()
          return b
        })()
      }
      backend = await backendPromise
      return backend
    }

    // livestream_talk — unprompted speech on stream
    api.registerTool(
      {
        name: 'livestream_talk',
        label: 'Livestream Talk',
        description:
          'Speak on the livestream unprompted. Shows a speech bubble on the overlay and generates TTS audio. Use for narration, vibes, and commentary — NOT for replying to chat (use livestream_reply for that).',
        parameters: Type.Object({
          text: Type.String({ description: 'Message to speak on stream' }),
        }),
        async execute(_toolCallId: string, params: unknown) {
          const b = await ensureBackend()
          const { text } = params as { text: string }
          const result = await b.handleTalk(text)
          return {
            content: [{ type: 'text', text: result.spoken ? `Spoke on stream: "${text}"` : 'Failed to speak' }],
            details: result,
          }
        },
      },
      { name: 'livestream_talk' },
    )

    // livestream_reply — reply to a chat message
    api.registerTool(
      {
        name: 'livestream_reply',
        label: 'Livestream Reply',
        description:
          'Reply to a chat message on the livestream. Reads the original message aloud with the chat voice, then speaks your reply with the bot voice. Use this ONLY when responding to a specific viewer message.',
        parameters: Type.Object({
          text: Type.String({ description: 'Your reply to the chat message' }),
          username: Type.String({ description: 'Username of the person you are replying to' }),
          message: Type.String({ description: 'The original chat message you are replying to' }),
        }),
        async execute(_toolCallId: string, params: unknown) {
          const b = await ensureBackend()
          const { text, username, message } = params as { text: string; username: string; message: string }
          const result = await b.handleReply(text, { username, message })
          return {
            content: [{ type: 'text', text: result.spoken ? `Replied to @${username}: "${text}"` : 'Failed to reply' }],
            details: result,
          }
        },
      },
      { name: 'livestream_reply' },
    )

    // livestream_notification — big notification on overlay
    api.registerTool(
      {
        name: 'livestream_notification',
        label: 'Livestream Notification',
        description:
          'Show a big notification on the livestream overlay with TTS. Use to highlight chat messages or announce events.',
        parameters: Type.Object({
          body: Type.String({ description: 'Notification text to display and speak' }),
        }),
        async execute(_toolCallId: string, params: unknown) {
          const b = await ensureBackend()
          const { body } = params as { body: string }
          const result = await b.handleNotification(body)
          return {
            content: [{ type: 'text', text: `Notification sent: "${body}"` }],
            details: result,
          }
        },
      },
      { name: 'livestream_notification' },
    )

    // Service lifecycle
    api.registerService({
      id: 'crawd',
      start: async () => {
        try {
          await ensureBackend()
          api.logger.info('crawd: backend started')
        } catch (err) {
          api.logger.error(
            `crawd: failed to start — ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      },
      stop: async () => {
        if (backendPromise) {
          try {
            const b = await backendPromise
            await b.stop()
          } finally {
            backendPromise = null
            backend = null
          }
        }
      },
    })
  },
}

export default plugin
