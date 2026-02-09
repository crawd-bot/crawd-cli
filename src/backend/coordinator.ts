import { randomUUID } from 'crypto'
import WebSocket from 'ws'
import type { ChatMessage } from '../lib/chat/types'

const DEFAULT_BATCH_WINDOW_MS = 20_000
const SESSION_KEY = process.env.CRAWD_CHANNEL_ID || 'agent:main:crawd:live'

/** Coordinator configuration */
export type CoordinatorConfig = {
  /** Whether autonomous vibing is enabled. Default: true */
  vibeEnabled: boolean
  /** How often to send vibe prompt when active (ms). Default: 60000 (1 min) */
  vibeIntervalMs: number
  /** Go idle after this much inactivity while active (ms). Default: 30000 (30 sec) */
  idleAfterMs: number
  /** Go sleep after this much inactivity while idle (ms). Default: 60000 (1 min) */
  sleepAfterIdleMs: number
  /** Chat message batching window (ms). Default: 20000 (20 sec) */
  chatBatchWindowMs: number
  /** The autonomous "vibe" prompt sent periodically */
  vibePrompt: string
}

export const DEFAULT_CONFIG: CoordinatorConfig = {
  vibeEnabled: true,
  vibeIntervalMs: 30_000,
  idleAfterMs: 180_000,
  sleepAfterIdleMs: 180_000,
  chatBatchWindowMs: DEFAULT_BATCH_WINDOW_MS,
  vibePrompt: `[CRAWD:VIBE] You are on a livestream. Make sure the crawd skill is loaded. Do one thing on the internet or ask the chat something. Respond with LIVESTREAM_REPLIED after using a tool, or NO_REPLY if you have nothing to say.`,
}

export type CoordinatorState = 'sleep' | 'idle' | 'active'

/** Parsed agent reply with optional message reference */
export type AgentReply = {
  text: string
  /** Formatted string of message being replied to (e.g., "@user: message") */
  replyTo: string | null
  /** Original message being replied to (for turn-based UI) */
  originalMessage: ChatMessage | null
}

/** Function signature for triggering an agent turn */
export type TriggerAgentFn = (message: string) => Promise<string[]>

/** Payload for a node.invoke.request event from the gateway */
export type InvokeRequestPayload = {
  id: string
  nodeId: string
  command: string
  paramsJSON?: string | null
  timeoutMs?: number
}

/** Interface for gateway client (allows mocking in tests) */
export interface IGatewayClient {
  connect(): Promise<void>
  disconnect(): void
  isConnected(): boolean
  isSessionBusy(): boolean
  triggerAgent(message: string): Promise<string[]>
  sendInvokeResult(id: string, nodeId: string, result: { ok: boolean; payload?: unknown; error?: { code: string; message: string } }): Promise<void>
  onInvokeRequest?: (payload: InvokeRequestPayload) => void
}

/** Clock interface for time control in tests */
export interface IClock {
  now(): number
  setTimeout(callback: () => void, ms: number): NodeJS.Timeout
  clearTimeout(timer: NodeJS.Timeout): void
  setInterval(callback: () => void, ms: number): NodeJS.Timeout
  clearInterval(timer: NodeJS.Timeout): void
}

/** Default clock using real timers */
export const realClock: IClock = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (t) => clearTimeout(t),
  setInterval: (cb, ms) => setInterval(cb, ms),
  clearInterval: (t) => clearInterval(t),
}

type GatewayFrame = {
  type: 'req' | 'res' | 'event'
  id?: string
  method?: string
  params?: Record<string, unknown>
  ok?: boolean
  payload?: {
    status?: 'accepted' | 'ok' | 'error'
    result?: {
      payloads?: Array<{ text?: string }>
    }
    [key: string]: unknown
  }
  result?: unknown
  error?: { code: number; message: string }
}

/**
 * Gateway client for OpenClaw WebSocket protocol (persistent connection).
 * Used by standalone mode (backend/index.ts) which needs persistent connection
 * for node.invoke event handling.
 */
export class GatewayClient implements IGatewayClient {
  private ws: WebSocket | null = null
  private url: string
  private token: string
  private connected = false
  private pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  /** Track active run IDs for our session to detect if agent is busy (runId → startTimestamp) */
  private activeRunIds = new Map<string, number>()
  private static readonly RUN_TTL_MS = 120_000
  private targetSessionKey: string
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private readonly maxReconnectDelay = 30_000
  private shouldReconnect = false

  /** Callback invoked when the gateway dispatches a node.invoke.request */
  onInvokeRequest?: (payload: InvokeRequestPayload) => void

  constructor(url: string, token: string, sessionKey: string = SESSION_KEY) {
    this.url = url
    this.token = token
    this.targetSessionKey = sessionKey
  }


  async connect(): Promise<void> {
    this.shouldReconnect = true
    return this.doConnect()
  }

  private async doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url)
      let settled = false

      this.ws.on('open', async () => {
        try {
          await this.authenticate()
          this.connected = true
          this.reconnectDelay = 1000
          console.log('[Gateway] Connected and authenticated')
          if (!settled) { settled = true; resolve() }
        } catch (err) {
          if (!settled) { settled = true; reject(err) }
        }
      })

      this.ws.on('message', (data) => {
        try {
          const frame = JSON.parse(data.toString()) as GatewayFrame
          this.handleFrame(frame)
        } catch (err) {
          console.error('[Gateway] Failed to parse message:', err)
        }
      })

      this.ws.on('close', () => {
        this.connected = false
        this.activeRunIds.clear()
        console.log('[Gateway] Disconnected')
        this.scheduleReconnect()
      })

      this.ws.on('error', (err) => {
        console.error('[Gateway] Error:', err)
        if (!settled) { settled = true; reject(err) }
      })
    })
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return
    if (this.reconnectTimer) return
    console.log(`[Gateway] Reconnecting in ${this.reconnectDelay / 1000}s...`)
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      try {
        await this.doConnect()
      } catch {
        // doConnect failed, bump delay and retry
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
        this.scheduleReconnect()
      }
    }, this.reconnectDelay)
  }

  private async authenticate(): Promise<void> {
    // Skip connected check since we're establishing the connection
    return this.request('connect', {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'gateway-client',
        version: '1.0.0',
        platform: 'node',
        mode: 'backend',
      },
      commands: ['talk'],
      auth: { token: this.token },
    }, true) as Promise<void>
  }

  private handleFrame(frame: GatewayFrame): void {
    // Log all incoming frames for debugging (skip noisy ones)
    if (frame.type !== 'res' || !frame.id?.startsWith('connect')) {
      // Skip logging frequent health/presence events
      const eventType = (frame as any).event
      if (eventType !== 'health' && eventType !== 'presence') {
        console.log('[Gateway] Frame received:', JSON.stringify(frame))
      }
    }

    // Handle node.invoke.request events from gateway
    if (frame.type === 'event') {
      const eventType = (frame as any).event
      if (eventType === 'node.invoke.request' && this.onInvokeRequest) {
        const payload = (frame as any).payload as InvokeRequestPayload
        if (payload?.id && payload?.command) {
          this.onInvokeRequest(payload)
        }
        return
      }
    }

    // Track agent run events for our session to detect busy state
    if (frame.type === 'event') {
      const payload = frame.payload as any
      const eventType = (frame as any).event

      if (eventType === 'agent' && payload?.sessionKey === this.targetSessionKey) {
        const runId = payload.runId as string | undefined
        const stream = payload.stream as string | undefined
        const phase = payload.data?.phase as string | undefined

        if (runId) {
          // Track run start/end based on lifecycle events or stream type
          // Lifecycle events: stream='lifecycle', data.phase='start'|'end'
          // Other activity: stream='tool'|'assistant'
          if (stream === 'lifecycle' && phase === 'start') {
            this.activeRunIds.set(runId, Date.now())
          } else if (stream === 'lifecycle' && (phase === 'end' || phase === 'error')) {
            this.activeRunIds.delete(runId)
          } else if (stream === 'tool' || stream === 'assistant') {
            // Also mark as active during streaming
            this.activeRunIds.set(runId, Date.now())
          }
        }
      }
    }

    if (frame.type === 'res' && frame.id) {
      const pending = this.pendingRequests.get(frame.id)
      if (pending) {
        if (frame.error) {
          this.pendingRequests.delete(frame.id)
          console.error('[Gateway] Request error:', frame.error)
          pending.reject(new Error(frame.error.message))
        } else if (frame.payload?.status === 'accepted') {
          // Agent request accepted but not complete yet - wait for final response
          console.log('[Gateway] Request accepted, waiting for result...')
        } else {
          // Final response (status "ok" or no status for non-agent requests)
          this.pendingRequests.delete(frame.id)
          pending.resolve(frame.payload ?? frame.result)
        }
      }
    }
  }

  private request(method: string, params: Record<string, unknown>, skipConnectedCheck = false): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket not initialized'))
        return
      }
      if (!skipConnectedCheck && !this.connected) {
        reject(new Error('Not connected'))
        return
      }

      const id = randomUUID()
      const frame: GatewayFrame = { type: 'req', id, method, params }

      this.pendingRequests.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(frame))

      // Timeout after 60s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error('Request timeout'))
        }
      }, 60_000)
    })
  }

  async triggerAgent(message: string): Promise<string[]> {
    const result = await this.request('agent', {
      message,
      idempotencyKey: randomUUID(),
      sessionKey: this.targetSessionKey,
    }) as any

    // Extract text from ALL payloads in agent response
    const payloads = result?.result?.payloads as Array<{ text?: string }> | undefined
    if (!payloads?.length) {
      console.log('[Gateway] Agent response (no payloads):', JSON.stringify(result, null, 2))
      return []
    }

    const texts = payloads
      .map(p => p.text)
      .filter((t): t is string => typeof t === 'string' && t.length > 0)

    if (texts.length > 0) {
      console.log(`[Gateway] Agent replied with ${texts.length} message(s):`, texts)
    } else {
      console.log('[Gateway] Agent response (no text in payloads):', JSON.stringify(result, null, 2))
    }

    return texts
  }

  isConnected(): boolean {
    return this.connected
  }

  /** Check if the target session has an active agent run (evicts stale entries beyond TTL) */
  isSessionBusy(): boolean {
    const now = Date.now()
    for (const [runId, startedAt] of this.activeRunIds) {
      if (now - startedAt > GatewayClient.RUN_TTL_MS) {
        this.activeRunIds.delete(runId)
      }
    }
    return this.activeRunIds.size > 0
  }

  async sendInvokeResult(
    id: string,
    nodeId: string,
    result: { ok: boolean; payload?: unknown; error?: { code: string; message: string } }
  ): Promise<void> {
    const params: Record<string, unknown> = { id, nodeId, ok: result.ok }
    if (result.payload !== undefined) params.payload = result.payload
    if (result.error) params.error = result.error
    await this.request('node.invoke.result', params)
  }

  disconnect(): void {
    this.shouldReconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
    this.connected = false
    this.activeRunIds.clear()
  }
}

/**
 * One-shot gateway client. Opens a fresh WebSocket per triggerAgent call —
 * authenticates, sends the agent request, waits for the full response, then closes.
 * No persistent connection or reconnect logic needed.
 */
export class OneShotGateway {
  constructor(
    private url: string,
    private token: string,
    private sessionKey: string = SESSION_KEY,
  ) {
    console.log(`[OneShotGateway] url=${url} session=${sessionKey}`)
  }

  async triggerAgent(message: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url)
      const authId = randomUUID()
      const agentId = randomUUID()
      let settled = false

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          ws.close()
          reject(new Error('One-shot gateway request timed out (120s)'))
        }
      }, 120_000)

      const finish = (result?: string[], error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        ws.close()
        if (error) {
          console.error(`[OneShotGateway] error: ${error.message}`)
          reject(error)
        } else {
          resolve(result ?? [])
        }
      }

      const sendConnect = () => {
        ws.send(JSON.stringify({
          type: 'req',
          id: authId,
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: 'gateway-client',
              version: '1.0.0',
              platform: 'node',
              mode: 'backend',
            },
            commands: ['talk'],
            auth: this.token ? { token: this.token } : {},
          },
        }))
      }

      ws.on('message', (data) => {
        try {
          const frame = JSON.parse(data.toString()) as GatewayFrame

          // Gateway sends connect.challenge before accepting connect requests
          if (frame.type === 'event' && (frame as any).event === 'connect.challenge') {
            sendConnect()
            return
          }

          if (frame.type === 'res' && frame.id === authId) {
            if (frame.error) {
              finish(undefined, new Error(`Gateway auth failed: ${frame.error.message}`))
              return
            }
            ws.send(JSON.stringify({
              type: 'req',
              id: agentId,
              method: 'agent',
              params: {
                message,
                idempotencyKey: randomUUID(),
                sessionKey: this.sessionKey,
              },
            }))
          } else if (frame.type === 'res' && frame.id === agentId) {
            if (frame.error) {
              finish(undefined, new Error(`Gateway agent request failed: ${frame.error.message}`))
              return
            }
            if (frame.payload?.status === 'accepted') return
            const payloads = (frame.payload as any)?.result?.payloads as Array<{ text?: string }> | undefined
            const texts = payloads
              ?.map(p => p.text)
              .filter((t): t is string => typeof t === 'string' && t.length > 0) ?? []
            finish(texts)
          }
          // Ignore other frames (health, agent stream events, etc.)
        } catch {
          // Parse error — ignore
        }
      })

      ws.on('error', (err) => {
        finish(undefined, err instanceof Error ? err : new Error(String(err)))
      })

      ws.on('close', () => {
        if (!settled) {
          finish(undefined, new Error('WebSocket closed unexpectedly'))
        }
      })
    })
  }
}

/**
 * Coordinator: batches chat messages and triggers agent turns.
 */
/** Grace period for filtering old messages (30 seconds before startup) */
const STARTUP_GRACE_MS = 30_000
/** How often to check for sleep condition (ms) */
const SLEEP_CHECK_INTERVAL_MS = 10_000

/** Dependencies that can be injected for testing */
export type CoordinatorDeps = {
  clock?: IClock
  logger?: Pick<Console, 'log' | 'error' | 'warn'>
}

/** Event types emitted by coordinator for observability */
export type CoordinatorEvent =
  | { type: 'stateChange'; from: CoordinatorState; to: CoordinatorState }
  | { type: 'vibeScheduled'; nextVibeAt: number }
  | { type: 'vibeExecuted'; skipped: boolean; reason?: string }
  | { type: 'sleepCheck'; inactiveForMs: number; willSleep: boolean }
  | { type: 'chatProcessed'; count: number }

export class Coordinator {
  private buffer: ChatMessage[] = []
  private timer: NodeJS.Timeout | null = null
  private triggerFn: TriggerAgentFn
  private onEvent?: (event: CoordinatorEvent) => void
  /** Timestamp when coordinator was created (used to filter old messages on restart) */
  private readonly startedAt: number

  // === State Machine ===
  private config: CoordinatorConfig
  private _state: CoordinatorState = 'sleep'
  private lastActivityAt = 0
  private idleSince = 0
  private vibeTimer: NodeJS.Timeout | null = null
  private sleepCheckTimer: NodeJS.Timeout | null = null
  /** True while a flush or talk is being processed — vibes should wait */
  private _busy = false
  /** Serializes all triggerAgent calls to prevent concurrent runs */
  private _gatewayQueue: Promise<void> = Promise.resolve()

  // === Injected dependencies ===
  private readonly clock: IClock
  private readonly logger: Pick<Console, 'log' | 'error' | 'warn'>

  /** Recent messages by shortId — used to look up chat messages for talk tool replies */
  private recentMessages = new Map<string, ChatMessage>()

  constructor(
    triggerAgent: TriggerAgentFn,
    config: Partial<CoordinatorConfig> = {},
    deps: CoordinatorDeps = {}
  ) {
    this.triggerFn = triggerAgent
    this.config = { ...DEFAULT_CONFIG, ...config }

    // Inject dependencies or use defaults
    this.clock = deps.clock ?? realClock
    this.logger = deps.logger ?? console
    this.startedAt = this.clock.now()
  }

  /** Get current state (public for testing) */
  get state(): CoordinatorState {
    return this._state
  }

  /** Update configuration at runtime */
  updateConfig(config: Partial<CoordinatorConfig>): void {
    this.config = { ...this.config, ...config }
    this.logger.log('[Coordinator] Config updated:', {
      vibeIntervalMs: this.config.vibeIntervalMs,
      chatBatchWindowMs: this.config.chatBatchWindowMs,
      idleAfterMs: this.config.idleAfterMs,
      sleepAfterIdleMs: this.config.sleepAfterIdleMs,
    })
  }

  /** Get current state and config */
  getState(): { state: CoordinatorState; lastActivityAt: number; config: CoordinatorConfig } {
    return {
      state: this._state,
      lastActivityAt: this.lastActivityAt,
      config: this.config,
    }
  }

  /** Look up a recent chat message by shortId (for talk tool replyTo) */
  getRecentMessage(shortId: string): ChatMessage | undefined {
    return this.recentMessages.get(shortId)
  }

  /** Set callback for coordinator events (useful for debugging/testing) */
  setOnEvent(callback: (event: CoordinatorEvent) => void): void {
    this.onEvent = callback
  }

  private emit(event: CoordinatorEvent): void {
    this.onEvent?.(event)
  }

  start(): void {
    this.logger.log('[Coordinator] Started in SLEEP state')
    this.logger.log('[Coordinator] Config:', {
      vibeIntervalMs: this.config.vibeIntervalMs,
      idleAfterMs: this.config.idleAfterMs,
      sleepAfterIdleMs: this.config.sleepAfterIdleMs,
    })
  }

  stop(): void {
    this.stopVibeLoop()
    if (this.timer) {
      this.clock.clearTimeout(this.timer)
      this.timer = null
    }
    this._state = 'sleep'
    this.logger.log('[Coordinator] Stopped')
  }

  // === State Machine Methods ===

  /** Wake up from sleep/idle state and start the vibe loop */
  wake(): void {
    if (this._state === 'active') return

    const from = this._state
    this._state = 'active'
    this.lastActivityAt = this.clock.now()
    this.logger.log('[Coordinator] WAKE - transitioning to ACTIVE state')
    this.emit({ type: 'stateChange', from, to: 'active' })

    this.startVibeLoop()
  }

  /** Go to idle state (between activities, eyes open) */
  goIdle(): void {
    if (this._state === 'idle') return
    if (this._state === 'sleep') return // Don't go from sleep to idle, need wake() first

    const from = this._state
    this._state = 'idle'
    this.idleSince = this.clock.now()
    this.logger.log('[Coordinator] IDLE - transitioning to IDLE state (waiting)')
    this.emit({ type: 'stateChange', from, to: 'idle' })

    // Keep vibe loop running but will check for sleep transition
  }

  /** Go to sleep state (extended inactivity, eyes closed) */
  goSleep(): void {
    if (this._state === 'sleep') return

    const from = this._state
    this._state = 'sleep'
    this.logger.log('[Coordinator] SLEEP - transitioning to SLEEP state')
    this.emit({ type: 'stateChange', from, to: 'sleep' })

    this.stopVibeLoop()
    this.compactSession()
  }

  /** Compact the agent's session context before sleeping to free stale history */
  private compactSession(): void {
    this._gatewayQueue = this._gatewayQueue.then(async () => {
      try {
        await this.triggerFn('/compact')
        this.logger.log('[Coordinator] Session compacted before sleep')
      } catch (err) {
        this.logger.error('[Coordinator] Failed to compact session:', err)
      }
    }).catch(() => {})
  }

  /** Signal that the agent is speaking (via tool call) — keeps coordinator awake */
  notifySpeech(): void {
    if (this._state !== 'active') this.wake()
    else this.resetActivity()
  }

  /** Reset activity timer (called on chat messages) */
  resetActivity(): void {
    this.lastActivityAt = this.clock.now()
  }

  /** Get time since last activity */
  getInactiveTime(): number {
    return this.clock.now() - this.lastActivityAt
  }

  /** Start the periodic vibe loop */
  private startVibeLoop(): void {
    this.stopVibeLoop() // Clear any existing timer

    // Start inactivity check timer (handles active → idle → sleep transitions)
    this.sleepCheckTimer = this.clock.setInterval(() => {
      const inactiveFor = this.clock.now() - this.lastActivityAt

      if (this._state === 'active') {
        // Active → Idle after idleAfterMs
        const willIdle = inactiveFor >= this.config.idleAfterMs
        this.emit({ type: 'sleepCheck', inactiveForMs: inactiveFor, willSleep: false })

        if (willIdle) {
          this.logger.log(`[Coordinator] No activity for ${Math.round(inactiveFor / 1000)}s, going idle`)
          this.goIdle()
        }
      } else if (this._state === 'idle') {
        // Idle → Sleep after sleepAfterIdleMs (measured from when we entered idle)
        const idleDuration = this.clock.now() - this.idleSince
        const willSleep = idleDuration >= this.config.sleepAfterIdleMs
        this.emit({ type: 'sleepCheck', inactiveForMs: idleDuration, willSleep })

        if (willSleep) {
          this.logger.log(`[Coordinator] Idle for ${Math.round(idleDuration / 1000)}s, going to sleep`)
          this.goSleep()
        }
      }
    }, SLEEP_CHECK_INTERVAL_MS)

    // Start vibe loop
    this.scheduleNextVibe()
  }

  /** Stop the vibe loop */
  private stopVibeLoop(): void {
    if (this.vibeTimer) {
      this.clock.clearTimeout(this.vibeTimer)
      this.vibeTimer = null
    }
    if (this.sleepCheckTimer) {
      this.clock.clearInterval(this.sleepCheckTimer)
      this.sleepCheckTimer = null
    }
  }

  /** Schedule the next vibe action */
  scheduleNextVibe(): void {
    // Vibe while active or idle (not while sleeping)
    if (this._state === 'sleep') return
    if (!this.config.vibeEnabled) return

    const nextVibeAt = this.clock.now() + this.config.vibeIntervalMs
    this.emit({ type: 'vibeScheduled', nextVibeAt })
    this.vibeTimer = this.clock.setTimeout(() => this.vibe(), this.config.vibeIntervalMs)
  }

  /** Execute one autonomous "vibe" action */
  async vibe(): Promise<void> {
    // Can vibe while active or idle (not while sleeping)
    if (this._state === 'sleep') {
      this.emit({ type: 'vibeExecuted', skipped: true, reason: 'sleeping' })
      return
    }

    // Skip vibe if a flush/talk is still in progress (waiting for overlay ack)
    if (this._busy) {
      this.logger.log('[Coordinator] Vibe skipped - talk in progress')
      this.emit({ type: 'vibeExecuted', skipped: true, reason: 'talk in progress' })
      this.scheduleNextVibe()
      return
    }

    // Transition to active if idle (vibing is activity)
    if (this._state === 'idle') {
      const from = this._state
      this._state = 'active'
      this.emit({ type: 'stateChange', from, to: 'active' })
    }

    this.logger.log('[Coordinator] Vibe - sending autonomous prompt')
    this.emit({ type: 'vibeExecuted', skipped: false })

    // Reset activity timer
    this.resetActivity()

    // Chain on the gateway queue to prevent concurrent triggerAgent() calls
    this._busy = true
    let noReply = false
    let misaligned: string[] = []
    const vibeOp = this._gatewayQueue.then(async () => {
      this._busy = true
      try {
        const replies = await this.triggerFn(this.config.vibePrompt)
        // Filter out API errors (429s, rate limits) — not agent responses
        const agentReplies = replies.filter(r => !this.isApiError(r))
        if (agentReplies.some(r => r.trim().toUpperCase() === 'NO_REPLY')) {
          noReply = true
        } else if (!this.isCompliantReply(agentReplies)) {
          misaligned = agentReplies.filter(r => {
            const t = r.trim().toUpperCase()
            return t !== 'NO_REPLY' && t !== 'LIVESTREAM_REPLIED'
          })
        }
        if (replies.length > agentReplies.length) {
          this.logger.warn(`[Coordinator] Filtered ${replies.length - agentReplies.length} API error(s) from vibe response`)
        }
      } catch (err) {
        this.logger.error('[Coordinator] Vibe failed:', err)
      } finally {
        this._busy = false
      }
    })
    this._gatewayQueue = vibeOp.catch(() => {})

    try {
      await vibeOp
    } catch {}

    if (noReply) {
      this.logger.log('[Coordinator] Agent sent NO_REPLY, going to sleep')
      this.goSleep()
      return
    }

    if (misaligned.length > 0) {
      this._gatewayQueue = this._gatewayQueue.then(() => this.sendMisalignment(misaligned)).catch(() => {})
    }

    // Schedule next vibe
    this.scheduleNextVibe()
  }

  /**
   * Called for each incoming chat message from any platform.
   * Uses leading-edge throttle: flushes immediately on first message,
   * then buffers during cooldown window.
   *
   * Also wakes up the coordinator if idle and resets activity timer.
   */
  onMessage(msg: ChatMessage): void {
    // Skip messages older than startup time (with grace period) to avoid
    // reprocessing chat history when container restarts
    const cutoff = this.startedAt - STARTUP_GRACE_MS
    if (msg.timestamp && msg.timestamp < cutoff) {
      return
    }

    // Buffer the message — don't wake yet. We only wake when the agent
    // actually produces a reply (talk tool or text fallback). This prevents
    // the bot from visually waking up and then doing nothing.
    this.buffer.push(msg)

    // Store for shortId lookup (talk tool replyTo). Cap at 200 to avoid unbounded growth.
    if (msg.shortId) {
      this.recentMessages.set(msg.shortId, msg)
      if (this.recentMessages.size > 200) {
        const oldest = this.recentMessages.keys().next().value!
        this.recentMessages.delete(oldest)
      }
    }

    // Leading edge: if no timer running, flush immediately and start cooldown
    if (!this.timer) {
      this.flush()
      this.timer = this.clock.setTimeout(() => this.onCooldownEnd(), this.config.chatBatchWindowMs)
    }
    // Otherwise, message is buffered and will be flushed when cooldown ends
  }

  private onCooldownEnd(): void {
    this.timer = null

    // If messages accumulated during cooldown, flush them and restart cooldown
    if (this.buffer.length > 0) {
      this.flush()
      this.timer = this.clock.setTimeout(() => this.onCooldownEnd(), this.config.chatBatchWindowMs)
    }
  }

  /** Whether the coordinator is busy processing a flush or talk */
  get busy(): boolean { return this._busy }

  /** Detect API/gateway errors surfaced as reply strings (e.g. rate limits) */
  private static readonly API_ERROR_RE = /^\d{3}\s+(status\s+code|error)|^rate\s*limit|^too\s+many\s+requests|^overloaded|^server\s+error/i

  private isApiError(reply: string): boolean {
    return Coordinator.API_ERROR_RE.test(reply.trim())
  }

  /** Check if agent replies are compliant (NO_REPLY or LIVESTREAM_REPLIED) */
  private isCompliantReply(replies: string[]): boolean {
    if (replies.length === 0) return true
    return replies.every(r => {
      const t = r.trim().toUpperCase()
      return t === 'NO_REPLY' || t === 'LIVESTREAM_REPLIED' || this.isApiError(r)
    })
  }

  /** Send misalignment correction when agent responds with plaintext */
  private async sendMisalignment(badReplies: string[]): Promise<void> {
    const leaked = badReplies.map(r => `"${r.slice(0, 80)}"`).join(', ')
    this.logger.warn(`[Coordinator] MISALIGNED — agent sent plaintext: ${leaked}`)
    try {
      await this.triggerFn(
        `[CRAWD:MISALIGNED] Your previous response was plaintext: ${leaked}. ` +
        `Plaintext is NEVER visible to viewers. You MUST use livestream_reply or livestream_talk tool calls to speak. ` +
        `After using a tool, respond with LIVESTREAM_REPLIED. If you have nothing to say, respond with NO_REPLY. ` +
        `Do not respond with any other text.`
      )
    } catch (err) {
      this.logger.error('[Coordinator] Misalignment correction failed:', err)
    }
  }

  private flush(): void {
    if (this.buffer.length === 0) return

    const batch = this.buffer.splice(0)
    const batchText = this.formatBatch(batch)

    this.logger.log(`[Coordinator] Flushing ${batch.length} messages`)
    this.emit({ type: 'chatProcessed', count: batch.length })

    // Chain on the gateway queue to prevent concurrent triggerAgent() calls
    this._busy = true
    this._gatewayQueue = this._gatewayQueue.then(async () => {
      this._busy = true
      try {
        const replies = await this.triggerFn(batchText)
        const agentReplies = replies.filter(r => !this.isApiError(r))
        if (replies.length > agentReplies.length) {
          this.logger.warn(`[Coordinator] Filtered ${replies.length - agentReplies.length} API error(s) from chat response`)
        }
        if (!this.isCompliantReply(agentReplies)) {
          await this.sendMisalignment(agentReplies.filter(r => {
            const t = r.trim().toUpperCase()
            return t !== 'NO_REPLY' && t !== 'LIVESTREAM_REPLIED'
          }))
        }
      } catch (err) {
        this.logger.error('[Coordinator] Failed to trigger agent:', err)
      } finally {
        this._busy = false
      }
    }).catch(() => {})
  }

  formatBatch(messages: ChatMessage[]): string {
    const duration = messages.length > 1
      ? Math.round((this.clock.now() - (messages[0].timestamp ?? this.clock.now())) / 1000)
      : 0

    const header = `[CRAWD:CHAT - ${messages.length} message${messages.length === 1 ? '' : 's'}${duration > 0 ? `, ${duration}s` : ''}]`
    const lines = messages.map(m => {
      const platform = m.platform && m.platform !== 'pumpfun' ? `[${m.platform.toUpperCase()}] ` : ''
      return `[${m.shortId}] ${platform}${m.username}: ${m.message}`
    })

    const instruction = messages.length > 1
      ? '\n(To reply to a specific message, prefix with its ID: [msgId] your reply)'
      : ''

    return `${header}\n${lines.join('\n')}${instruction}`
  }
}
