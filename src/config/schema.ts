import { z } from 'zod'

const ttsProviderEnum = z.enum(['openai', 'elevenlabs', 'tiktok'])

export const ConfigSchema = z.object({
  /** Gateway configuration */
  gateway: z.object({
    url: z.string().default('ws://localhost:18789'),
    /** Channel ID for the agent session */
    channelId: z.string().default('agent:main:crawd:live'),
  }).default({}),

  /** Server ports */
  ports: z.object({
    backend: z.number().default(4000),
    overlay: z.number().default(3000),
  }).default({}),

  /** TTS configuration */
  tts: z.object({
    /** Provider for reading chat messages aloud */
    chatProvider: ttsProviderEnum.default('tiktok'),
    /** Voice ID for chat TTS (must match chatProvider) */
    chatVoice: z.string().default('en_us_002'),
    /** Provider for bot speech */
    botProvider: ttsProviderEnum.default('elevenlabs'),
    /** Voice ID for bot TTS (must match botProvider) */
    botVoice: z.string().default('TX3LPaxmHKxFdv7VOQHJ'),
  }).default({}),

  /** Chat platform configuration */
  chat: z.object({
    pumpfun: z.object({
      enabled: z.boolean().default(false),
      tokenMint: z.string().optional(),
    }).optional(),
    youtube: z.object({
      enabled: z.boolean().default(false),
      videoId: z.string().optional(),
    }).default({}),
  }).default({}),

  /** Autonomous vibing state machine */
  vibe: z.object({
    /** Enable autonomous vibing (agent acts on its own between chat messages) */
    enabled: z.boolean().default(true),
    /** Seconds between vibe pings while active */
    interval: z.number().default(30),
    /** Seconds of inactivity before going idle */
    idleAfter: z.number().default(180),
    /** Seconds of inactivity before going to sleep (must be > idleAfter) */
    sleepAfter: z.number().default(360),
  }).default({}),

  /** Stream configuration */
  stream: z.object({
    /** RTMP stream key for pump.fun */
    key: z.string().optional(),
  }).default({}),

})

export type Config = z.infer<typeof ConfigSchema>

/** Default configuration */
export const DEFAULT_CONFIG: Config = ConfigSchema.parse({})
