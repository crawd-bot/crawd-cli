/**
 * CrawdBackend — encapsulates the Fastify+Socket.IO server, coordinator,
 * and chat system. Used by both standalone mode (backend/index.ts) and the
 * OpenClaw plugin (plugin.ts).
 *
 * TTS generation has been moved to the overlay (Next.js server actions).
 * This backend now sends text-only events.
 */
import { randomUUID } from 'crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { Server } from 'socket.io'
import { pumpfun } from '../lib/pumpfun/v2/index.js'
import { ChatManager } from '../lib/chat/manager.js'
import { PumpFunChatClient } from '../lib/chat/pumpfun/client.js'
import { YouTubeChatClient } from '../lib/chat/youtube/client.js'
import { Coordinator, OneShotGateway, type CoordinatorConfig, type CoordinatorEvent, type Plan, type AutonomyMode } from './coordinator.js'
import { generateShortId } from '../lib/chat/types.js'
import type { ChatMessage } from '../lib/chat/types.js'

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export type CrawdConfig = {
  enabled: boolean
  port: number
  bindHost: string
  autonomyMode?: AutonomyMode
  vibe: {
    enabled: boolean
    intervalMs: number
    idleAfterMs: number
    sleepAfterIdleMs: number
    batchWindowMs: number
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
    this.buildVersion = randomUUID()
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async start(): Promise<void> {
    await this.fastify.register(cors, { origin: true })

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

  /** Speak on the livestream — emits text-only overlay event. Blocks until overlay finishes. */
  async handleTalk(text: string): Promise<{ spoken: boolean }> {
    if (!text || typeof text !== 'string') {
      return { spoken: false }
    }

    this.coordinator?.notifySpeech()

    const id = randomUUID()
    this.io.emit('crawd:talk', { id, message: text })

    await this.waitForAck(id)
    return { spoken: true }
  }

  /**
   * Reply to a chat message — emits text-only overlay event with chat + bot message.
   * Blocks until overlay finishes.
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
    this.io.emit('crawd:reply-turn', {
      id,
      chat: { username: chat.username, message: chat.message },
      botMessage: text,
    })

    await this.waitForAck(id)
    return { spoken: true }
  }

  // =========================================================================
  // Plan API (used by plugin tool handlers)
  // =========================================================================

  setPlan(goal: string, steps: string[]): { plan: Plan } | { error: string } {
    if (!this.coordinator) return { error: 'Coordinator not enabled' }
    const plan = this.coordinator.setPlan(goal, steps)
    return { plan }
  }

  markPlanStepDone(step: number): { plan: Plan } | { error: string } {
    if (!this.coordinator) return { error: 'Coordinator not enabled' }
    const plan = this.coordinator.markStepDone(step)
    if (!plan) return { error: 'No active plan or invalid step index' }
    return { plan }
  }

  abandonPlan(): { plan: Plan } | { error: string } {
    if (!this.coordinator) return { error: 'Coordinator not enabled' }
    const plan = this.coordinator.abandonPlan()
    if (!plan) return { error: 'No active plan to abandon' }
    return { plan }
  }

  getPlan(): { plan: Plan | null } {
    return { plan: this.coordinator?.getPlan() ?? null }
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
        autonomyMode: this.config.autonomyMode ?? 'vibe',
        vibeIntervalMs: this.config.vibe.intervalMs,
        idleAfterMs: this.config.vibe.idleAfterMs,
        sleepAfterIdleMs: this.config.vibe.sleepAfterIdleMs,
        batchWindowMs: this.config.vibe.batchWindowMs,
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
        } else if (event.type === 'planNudgeExecuted' && !event.skipped) {
          this.io.emit('crawd:status', { status: 'planning' })
        } else if (event.type === 'planCreated') {
          this.io.emit('crawd:plan', { type: 'created', planId: event.planId, goal: event.goal })
        } else if (event.type === 'planCompleted') {
          this.io.emit('crawd:plan', { type: 'completed', planId: event.planId })
        } else if (event.type === 'planAbandoned') {
          this.io.emit('crawd:plan', { type: 'abandoned', planId: event.planId })
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

      // Sync current coordinator state so the overlay knows the initial animation
      if (this.coordinator) {
        socket.emit('crawd:status', { status: this.coordinator.state })
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

    this.fastify.get('/plan', async () => {
      return this.getPlan()
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

        const id = randomUUID()
        this.io.emit('crawd:reply-turn', {
          id,
          chat: { username, message },
          botMessage: response,
        })

        return { ok: true, id }
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
  const rawMode = process.env.AUTONOMY_MODE
  const autonomyMode = (rawMode === 'vibe' || rawMode === 'plan' || rawMode === 'none') ? rawMode : undefined

  return {
    enabled: true,
    port,
    bindHost: process.env.BIND_HOST || '0.0.0.0',
    autonomyMode,
    vibe: {
      enabled: process.env.VIBE_ENABLED !== 'false',
      intervalMs: Number(process.env.VIBE_INTERVAL_MS || 30_000),
      idleAfterMs: Number(process.env.IDLE_AFTER_MS || 180_000),
      sleepAfterIdleMs: Number(process.env.SLEEP_AFTER_IDLE_MS || 180_000),
      batchWindowMs: Number(process.env.CHAT_BATCH_WINDOW_MS || 20_000),
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
