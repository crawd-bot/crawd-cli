import { z } from 'zod'

export const ConfigSchema = z.object({
  /** API key for crawd.bot platform */
  apiKey: z.string().optional(),

  /** Gateway configuration */
  gateway: z.object({
    url: z.string().default('ws://localhost:18789'),
    token: z.string().optional(),
    /** Channel ID for the agent session */
    channelId: z.string().default('live'),
  }).default({}),

  /** Server ports */
  ports: z.object({
    backend: z.number().default(4000),
    overlay: z.number().default(3000),
  }).default({}),

  /** TTS configuration */
  tts: z.object({
    provider: z.enum(['openai', 'elevenlabs']).default('openai'),
    voice: z.string().optional(),
  }).default({}),

  /** Chat platform configuration */
  chat: z.object({
    pumpfun: z.object({
      enabled: z.boolean().default(false),
      tokenMint: z.string().optional(),
    }).default({}),
    youtube: z.object({
      enabled: z.boolean().default(false),
      videoId: z.string().optional(),
    }).default({}),
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
