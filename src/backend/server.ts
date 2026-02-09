/**
 * CrawdBackend — encapsulates the Fastify+Socket.IO server, TTS, coordinator,
 * and chat system. Used by both standalone mode (backend/index.ts) and the
 * OpenClaw plugin (plugin.ts).
 */
import { randomUUID } from 'crypto'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import cors from '@fastify/cors'
import { Server } from 'socket.io'
import OpenAI from 'openai'
import { pumpfun } from '../lib/pumpfun/v2/index.js'
import { ChatManager } from '../lib/chat/manager.js'
import { PumpFunChatClient } from '../lib/chat/pumpfun/client.js'
import { YouTubeChatClient } from '../lib/chat/youtube/client.js'
import { Coordinator, OneShotGateway, type CoordinatorConfig, type CoordinatorEvent } from './coordinator.js'
import { generateShortId } from '../lib/chat/types.js'
import { configureTikTokTTS, generateTikTokTTS } from '../lib/tts/tiktok.js'
import type { ChatMessage } from '../lib/chat/types.js'

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export type TtsVoiceEntry = {
  provider: 'openai' | 'elevenlabs' | 'tiktok'
  voice: string
}

export type CrawdConfig = {
  enabled: boolean
  port: number
  bindHost: string
  backendUrl?: string
  tts: {
    chat: TtsVoiceEntry[]
    bot: TtsVoiceEntry[]
    openaiApiKey?: string
    elevenlabsApiKey?: string
    tiktokSessionId?: string
  }
  vibe: {
    enabled: boolean
    intervalMs: number
    idleAfterMs: number
    sleepAfterIdleMs: number
    prompt?: string
  }
  chat: {
    youtube: {
      enabled: boolean
      videoId?: string
    }
    pumpfun: {
      enabled: boolean
      tokenMint?: string
      authToken?: string
    }
  }
  gatewayUrl?: string
  gatewayToken?: string
}

export type CrawdLogger = {
  info: (msg: string, ...args: unknown[]) => void
  warn: (msg: string, ...args: unknown[]) => void
  error: (msg: string, ...args: unknown[]) => void
}

const defaultLogger: CrawdLogger = {
  info: (...args) => console.log('[Crawd]', ...args),
  warn: (...args) => console.warn('[Crawd]', ...args),
  error: (...args) => console.error('[Crawd]', ...args),
}

// ---------------------------------------------------------------------------
// CrawdBackend
// ---------------------------------------------------------------------------

export class CrawdBackend {
  private fastify: FastifyInstance
  private io!: Server
  private config: CrawdConfig
  private logger: CrawdLogger

  private openai: OpenAI | null = null
  private elevenlabs: any = null
  private ttsDir: string
  private backendUrl: string
  private buildVersion: string

  private chatManager: ChatManager | null = null
  coordinator: Coordinator | null = null
  private latestMcap: number | null = null
  private mcapInterval: NodeJS.Timeout | null = null

  /** Pending overlay acks — resolves when overlay finishes playing audio for a given event ID */
  private pendingAcks = new Map<string, { resolve: () => void; timer: ReturnType<typeof setTimeout> }>()
  private static readonly ACK_TIMEOUT_MS = 60_000

  constructor(config: CrawdConfig, logger?: CrawdLogger) {
    this.config = config
    this.logger = logger ?? defaultLogger
    this.fastify = Fastify({ logger: true })
    this.ttsDir = join(process.cwd(), 'tmp', 'tts')
    this.backendUrl = config.backendUrl ?? `http://localhost:${config.port}`
    this.buildVersion = randomUUID()

    // Initialize TTS providers based on config
    if (config.tts.openaiApiKey) {
      this.openai = new OpenAI({ apiKey: config.tts.openaiApiKey })
    }
    if (config.tts.tiktokSessionId) {
      configureTikTokTTS(config.tts.tiktokSessionId)
    }
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async start(): Promise<void> {
    // Lazy-init ElevenLabs (optional dep)
    if (this.config.tts.elevenlabsApiKey && !this.elevenlabs) {
      try {
        const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js')
        this.elevenlabs = new ElevenLabsClient({ apiKey: this.config.tts.elevenlabsApiKey })
      } catch {
        this.logger.warn('ElevenLabs SDK not installed, ElevenLabs TTS disabled')
      }
    }

    await this.fastify.register(cors, { origin: true })
    await mkdir(this.ttsDir, { recursive: true })
    await this.fastify.register(fastifyStatic, {
      root: this.ttsDir,
      prefix: '/tts/',
      decorateReply: false,
    })

    this.io = new Server(this.fastify.server, {
      cors: { origin: '*' },
    })

    this.registerSocketHandlers()
    this.registerHttpRoutes()
    await this.startChatSystem()

    const host = this.config.bindHost
    await this.fastify.listen({ port: this.config.port, host })

    this.pollMarketCap()
    this.mcapInterval = setInterval(() => this.pollMarketCap(), 10_000)

    this.logger.info(`Backend started on ${host}:${this.config.port}`)
  }

  async stop(): Promise<void> {
    if (this.mcapInterval) {
      clearInterval(this.mcapInterval)
      this.mcapInterval = null
    }
    this.coordinator?.stop()
    this.chatManager?.disconnectAll()
    this.io?.close()
    await this.fastify.close()
    this.logger.info('Backend stopped')
  }

  // =========================================================================
  // Public API (used by plugin tool handlers)
  // =========================================================================

  /** Speak on the livestream — emits overlay event + TTS. Blocks until overlay finishes playing. */
  async handleTalk(text: string): Promise<{ spoken: boolean }> {
    if (!text || typeof text !== 'string') {
      return { spoken: false }
    }

    this.coordinator?.notifySpeech()

    const id = randomUUID()
    try {
      const tts = await this.generateTTSWithFallback(text, this.config.tts.bot)
      this.logger.info(`TTS generated: ${tts.url}`)
      this.io.emit('crawd:talk', { id, message: text, ttsUrl: tts.url, ttsProvider: tts.provider })
    } catch (e) {
      this.logger.error('Failed to generate TTS, emitting without audio', e)
      this.io.emit('crawd:talk', { id, message: text, ttsUrl: '' })
    }

    await this.waitForAck(id)
    return { spoken: true }
  }

  /**
   * Reply to a chat message — reads original aloud (chat voice),
   * then speaks bot reply (bot voice). Emits `crawd:reply-turn`.
   * Blocks until overlay finishes playing both audios.
   */
  async handleReply(
    text: string,
    chat: { username: string; message: string },
  ): Promise<{ spoken: boolean }> {
    if (!text || typeof text !== 'string') {
      return { spoken: false }
    }

    this.coordinator?.notifySpeech()

    const id = randomUUID()
    try {
      const [chatTts, botTts] = await Promise.all([
        this.generateTTSWithFallback(`Chat says: ${chat.message}`, this.config.tts.chat),
        this.generateTTSWithFallback(text, this.config.tts.bot),
      ])
      this.io.emit('crawd:reply-turn', {
        id,
        chat: { username: chat.username, message: chat.message },
        botMessage: text,
        chatTtsUrl: chatTts.url,
        botTtsUrl: botTts.url,
        chatTtsProvider: chatTts.provider,
        botTtsProvider: botTts.provider,
      })
    } catch (e) {
      this.logger.error('Failed to generate reply-turn TTS, falling back to talk', e)
      try {
        const tts = await this.generateTTSWithFallback(text, this.config.tts.bot)
        this.io.emit('crawd:talk', { id, message: text, ttsUrl: tts.url, ttsProvider: tts.provider })
      } catch {
        this.io.emit('crawd:talk', { id, message: text, ttsUrl: '' })
      }
    }

    await this.waitForAck(id)
    return { spoken: true }
  }

  getIO(): Server {
    return this.io
  }

  /** Wait for overlay to ack that audio finished playing. Resolves on timeout as fallback. */
  private waitForAck(id: string): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(id)
        this.logger.warn(`Talk ack timed out (${id}), resolving anyway`)
        resolve()
      }, CrawdBackend.ACK_TIMEOUT_MS)
      this.pendingAcks.set(id, { resolve, timer })
    })
  }

  /** Resolve a pending ack (called when overlay sends crawd:talk:done) */
  private resolveAck(id: string): void {
    const pending = this.pendingAcks.get(id)
    if (pending) {
      clearTimeout(pending.timer)
      this.pendingAcks.delete(id)
      pending.resolve()
    }
  }

  // =========================================================================
  // TTS (with ordered fallback chain)
  // =========================================================================

  async generateTTSWithFallback(text: string, chain: TtsVoiceEntry[]): Promise<{ url: string; provider: TtsVoiceEntry['provider'] }> {
    let lastError: Error | null = null

    for (const entry of chain) {
      try {
        let url: string
        switch (entry.provider) {
          case 'elevenlabs':
            url = await this.generateElevenLabsTTS(text, entry.voice)
            break
          case 'openai':
            url = await this.generateOpenAITTS(text, entry.voice)
            break
          case 'tiktok':
            url = await this.generateTikTokTTSFile(text, entry.voice)
            break
        }
        return { url, provider: entry.provider }
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e))
        this.logger.warn(`TTS ${entry.provider}/${entry.voice} failed: ${lastError.message}, trying next...`)
      }
    }

    throw lastError ?? new Error('No TTS providers configured')
  }

  private async generateOpenAITTS(text: string, voice: string): Promise<string> {
    if (!this.openai) throw new Error('OpenAI not configured (missing apiKey)')

    const response = await this.openai.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice: voice as 'onyx',
      input: text,
    })

    const buffer = Buffer.from(await response.arrayBuffer())
    return await this.saveTTSFile(buffer)
  }

  private async generateElevenLabsTTS(text: string, voiceId: string): Promise<string> {
    if (!this.elevenlabs) throw new Error('ElevenLabs not configured (missing apiKey)')

    const audio = await this.elevenlabs.textToSpeech.convert(voiceId, {
      modelId: 'eleven_multilingual_v2',
      text,
      outputFormat: 'mp3_44100_128',
      voiceSettings: {
        stability: 0,
        similarityBoost: 1.0,
        useSpeakerBoost: true,
        speed: 1.0,
      },
    })

    const response = new Response(audio as any)
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Check if response is valid MP3
    const isMP3 =
      (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) ||
      (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)

    if (!isMP3) {
      const preview = buffer.subarray(0, 200).toString('utf-8')
      throw new Error(`ElevenLabs returned non-audio response: ${preview.slice(0, 100)}`)
    }

    return await this.saveTTSFile(buffer)
  }

  private async generateTikTokTTSFile(text: string, voice?: string): Promise<string> {
    const buffer = await generateTikTokTTS(text, voice)
    return await this.saveTTSFile(buffer)
  }

  private async saveTTSFile(buffer: Buffer): Promise<string> {
    const filename = `${randomUUID()}.mp3`
    await mkdir(this.ttsDir, { recursive: true })
    await writeFile(join(this.ttsDir, filename), buffer)
    this.logger.info(`TTS file written: ${filename}, size: ${buffer.length} bytes`)
    return `${this.backendUrl}/tts/${filename}`
  }

  // =========================================================================
  // Chat system + Coordinator
  // =========================================================================

  private async startChatSystem(): Promise<void> {
    this.chatManager = new ChatManager()

    const pf = this.config.chat.pumpfun
    if (pf.enabled && pf.tokenMint) {
      this.chatManager.registerClient(
        'pumpfun',
        new PumpFunChatClient(pf.tokenMint, pf.authToken ?? null),
      )
    }

    const yt = this.config.chat.youtube
    if (yt.enabled && yt.videoId) {
      this.chatManager.registerClient('youtube', new YouTubeChatClient(yt.videoId))
    }

    this.chatManager.onMessage((msg: ChatMessage) => {
      this.fastify.log.info({ platform: msg.platform, user: msg.username }, 'chat message')
      this.io.emit('crawd:chat', msg)
      this.coordinator?.onMessage(msg)
    })

    if (this.config.gatewayUrl) {
      const gateway = new OneShotGateway(
        this.config.gatewayUrl,
        this.config.gatewayToken ?? '',
      )

      const coordConfig: Partial<CoordinatorConfig> = {
        vibeEnabled: this.config.vibe.enabled,
        vibeIntervalMs: this.config.vibe.intervalMs,
        idleAfterMs: this.config.vibe.idleAfterMs,
        sleepAfterIdleMs: this.config.vibe.sleepAfterIdleMs,
      }
      if (this.config.vibe.prompt) {
        coordConfig.vibePrompt = this.config.vibe.prompt
      }

      this.coordinator = new Coordinator(
        gateway.triggerAgent.bind(gateway),
        coordConfig,
      )

      this.coordinator.setOnEvent((event: CoordinatorEvent) => {
        if (event.type === 'stateChange') {
          this.io.emit('crawd:status', { status: event.to })
        } else if (event.type === 'vibeExecuted' && !event.skipped) {
          this.io.emit('crawd:status', { status: 'vibing' })
        } else if (event.type === 'chatProcessed') {
          this.io.emit('crawd:status', { status: 'chatting' })
        }
      })

      this.coordinator.start()
      this.fastify.log.info('Coordinator started (one-shot gateway)')
    } else {
      this.fastify.log.warn('Gateway not configured — coordinator disabled')
    }

    await this.chatManager.connectAll()
  }

  // =========================================================================
  // Socket.IO handlers
  // =========================================================================

  private registerSocketHandlers(): void {
    this.io.on('connection', (socket) => {
      this.fastify.log.info(`socket connected: ${socket.id}`)

      if (this.latestMcap !== null) {
        socket.emit('crawd:mcap', { mcap: this.latestMcap })
      }

      socket.on('crawd:talk:done', (data: { id?: string }) => {
        if (data?.id) {
          this.logger.info(`Talk ack received: ${data.id}`)
          this.resolveAck(data.id)
        }
      })

      socket.on('crawd:mock-chat', (data: { username?: string; message?: string }) => {
        const { username, message } = data
        if (!username || !message) return
        const mockMsg: ChatMessage = {
          id: randomUUID(),
          shortId: generateShortId(),
          username,
          message,
          platform: 'youtube',
          timestamp: Date.now(),
        }
        this.fastify.log.info({ username, message }, 'mock chat (socket)')
        this.io.emit('crawd:chat', mockMsg)
        if (this.coordinator) {
          this.coordinator.onMessage(mockMsg)
        } else {
          this.fastify.log.warn('mock chat: coordinator is null — gateway not configured or failed to connect')
        }
      })

      socket.on('disconnect', () => {
        this.fastify.log.info(`socket disconnected: ${socket.id}`)
      })
    })
  }

  // =========================================================================
  // HTTP routes
  // =========================================================================

  private registerHttpRoutes(): void {
    this.fastify.post<{ Body: { message: string } }>(
      '/crawd/talk',
      async (request, reply) => {
        const { message } = request.body
        if (!message || typeof message !== 'string') {
          return reply.status(400).send({ error: 'message is required' })
        }
        await this.handleTalk(message)
        return { ok: true }
      },
    )

    this.fastify.get('/chat/status', async () => {
      return { connected: this.chatManager?.getConnectedKeys() ?? [] }
    })

    this.fastify.get('/version', async () => {
      return { version: this.buildVersion }
    })

    this.fastify.get('/coordinator/status', async () => {
      if (!this.coordinator) return { enabled: false }
      return { enabled: true, ...this.coordinator.getState() }
    })

    this.fastify.post<{ Body: Partial<CoordinatorConfig> }>(
      '/coordinator/config',
      async (request, reply) => {
        if (!this.coordinator) {
          return reply.status(400).send({ error: 'Coordinator not enabled' })
        }
        this.coordinator.updateConfig(request.body)
        return { ok: true, ...this.coordinator.getState() }
      },
    )

    this.fastify.post<{ Body: { username: string; message: string } }>(
      '/mock/chat',
      async (request, reply) => {
        const { username, message } = request.body
        if (!username || !message) {
          return reply.status(400).send({ error: 'username and message are required' })
        }
        const id = randomUUID()
        const mockMsg: ChatMessage = {
          id,
          shortId: generateShortId(),
          username,
          message,
          platform: 'youtube',
          timestamp: Date.now(),
        }
        this.fastify.log.info({ username, message }, 'mock chat message')
        this.io.emit('crawd:chat', mockMsg)
        this.coordinator?.onMessage(mockMsg)
        return { ok: true, id }
      },
    )

    this.fastify.post<{ Body: { username: string; message: string; response: string } }>(
      '/mock/turn',
      async (request, reply) => {
        const { username, message, response } = request.body
        if (!username || !message || !response) {
          return reply.status(400).send({ error: 'username, message, and response are required' })
        }

        try {
          const [chatTts, botTts] = await Promise.all([
            this.generateTTSWithFallback(`Chat says: ${message}`, this.config.tts.chat),
            this.generateTTSWithFallback(response, this.config.tts.bot),
          ])
          this.io.emit('crawd:reply-turn', {
            id: randomUUID(),
            chat: { username, message },
            botMessage: response,
            chatTtsUrl: chatTts.url,
            botTtsUrl: botTts.url,
            chatTtsProvider: chatTts.provider,
            botTtsProvider: botTts.provider,
          })
          return { ok: true }
        } catch (e) {
          this.fastify.log.error(e, 'failed to generate mock turn TTS')
          return reply.status(500).send({ error: 'Failed to generate TTS' })
        }
      },
    )
  }

  // =========================================================================
  // Market cap polling
  // =========================================================================

  private async pollMarketCap(): Promise<void> {
    const mint = this.config.chat.pumpfun.tokenMint
    if (!mint) return

    try {
      const coin = await pumpfun.getCoin(mint)
      this.latestMcap = coin.usd_market_cap
      this.io.emit('crawd:mcap', { mcap: this.latestMcap })
    } catch (e) {
      this.fastify.log.error(e, 'failed to fetch market cap')
    }
  }
}

// ---------------------------------------------------------------------------
// Config builder: create CrawdConfig from environment variables
// (used by standalone mode in backend/index.ts)
// ---------------------------------------------------------------------------

export function configFromEnv(): CrawdConfig {
  const port = Number(process.env.PORT || 4000)

  const botChain: TtsVoiceEntry[] = []
  const chatChain: TtsVoiceEntry[] = []

  if (process.env.ELEVENLABS_API_KEY) {
    botChain.push({ provider: 'elevenlabs', voice: process.env.TTS_BOT_VOICE || 'TX3LPaxmHKxFdv7VOQHJ' })
  }
  if (process.env.OPENAI_API_KEY) {
    botChain.push({ provider: 'openai', voice: process.env.TTS_BOT_VOICE || 'onyx' })
  }

  if (process.env.TIKTOK_SESSION_ID) {
    chatChain.push({ provider: 'tiktok', voice: process.env.TTS_CHAT_VOICE || 'en_us_002' })
  }
  if (process.env.OPENAI_API_KEY) {
    chatChain.push({ provider: 'openai', voice: process.env.TTS_CHAT_VOICE || 'onyx' })
  }

  return {
    enabled: true,
    port,
    bindHost: process.env.BIND_HOST || '0.0.0.0',
    backendUrl: process.env.BACKEND_URL || `http://localhost:${port}`,
    tts: {
      chat: chatChain,
      bot: botChain,
      openaiApiKey: process.env.OPENAI_API_KEY,
      elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
      tiktokSessionId: process.env.TIKTOK_SESSION_ID,
    },
    vibe: {
      enabled: process.env.VIBE_ENABLED !== 'false',
      intervalMs: Number(process.env.VIBE_INTERVAL_MS || 30_000),
      idleAfterMs: Number(process.env.IDLE_AFTER_MS || 180_000),
      sleepAfterIdleMs: Number(process.env.SLEEP_AFTER_IDLE_MS || 180_000),
      prompt: process.env.VIBE_PROMPT,
    },
    chat: {
      youtube: {
        enabled: process.env.YOUTUBE_ENABLED === 'true',
        videoId: process.env.YOUTUBE_VIDEO_ID,
      },
      pumpfun: {
        enabled: process.env.PUMPFUN_ENABLED !== 'false',
        tokenMint: process.env.NEXT_PUBLIC_TOKEN_MINT,
        authToken: process.env.PUMPFUN_AUTH_TOKEN,
      },
    },
    gatewayUrl: process.env.OPENCLAW_GATEWAY_URL,
    gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN,
  }
}
