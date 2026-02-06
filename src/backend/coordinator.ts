import { randomUUID } from 'crypto'
import WebSocket from 'ws'
import type { ChatMessage } from '../lib/chat/types'

const BATCH_WINDOW_MS = 20_000
const SESSION_KEY = process.env.CRAWD_CHANNEL_ID || 'crawd:live'

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
  /** The autonomous "vibe" prompt sent periodically */
  vibePrompt: string
}

export const DEFAULT_CONFIG: CoordinatorConfig = {
  vibeEnabled: true,
  vibeIntervalMs: 30_000,
  idleAfterMs: 180_000,
  sleepAfterIdleMs: 180_000,
  vibePrompt: `[VIBE] Do one thing on the internet or ask the chat something.`,
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
 * Gateway client for OpenClaw WebSocket protocol.
 */
export class GatewayClient implements IGatewayClient {
  private ws: WebSocket | null = null
  private url: string
  private token: string
  private connected = false
  private pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  /** Track active run IDs for our session to detect if agent is busy */
  private activeRunIds = new Set<string>()
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
            this.activeRunIds.add(runId)
          } else if (stream === 'lifecycle' && (phase === 'end' || phase === 'error')) {
            this.activeRunIds.delete(runId)
          } else if (stream === 'tool' || stream === 'assistant') {
            // Also mark as active during streaming
            this.activeRunIds.add(runId)
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

  /** Check if the target session has an active agent run */
  isSessionBusy(): boolean {
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
 * Coordinator: batches chat messages and triggers agent turns via gateway.
 */
/** Grace period for filtering old messages (30 seconds before startup) */
const STARTUP_GRACE_MS = 30_000
/** How often to check for sleep condition (ms) */
const SLEEP_CHECK_INTERVAL_MS = 10_000

/** Dependencies that can be injected for testing */
export type CoordinatorDeps = {
  gateway?: IGatewayClient
  gatewayFactory?: (url: string, token: string) => IGatewayClient
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
  private gateway: IGatewayClient | null = null
  private gatewayUrl: string
  private gatewayToken: string
  private onEvent?: (event: CoordinatorEvent) => void
  /** Timestamp when coordinator was created (used to filter old messages on restart) */
  private readonly startedAt: number

  // === State Machine ===
  private config: CoordinatorConfig
  private _state: CoordinatorState = 'sleep'
  private lastActivityAt = 0
  private vibeTimer: NodeJS.Timeout | null = null
  private sleepCheckTimer: NodeJS.Timeout | null = null

  // === Injected dependencies ===
  private readonly clock: IClock
  private readonly logger: Pick<Console, 'log' | 'error' | 'warn'>
  private readonly gatewayFactory: (url: string, token: string) => IGatewayClient

  constructor(
    gatewayUrl: string,
    gatewayToken: string,
    config: Partial<CoordinatorConfig> = {},
    deps: CoordinatorDeps = {}
  ) {
    this.gatewayUrl = gatewayUrl
    this.gatewayToken = gatewayToken
    this.config = { ...DEFAULT_CONFIG, ...config }

    // Inject dependencies or use defaults
    this.clock = deps.clock ?? realClock
    this.logger = deps.logger ?? console
    this.gatewayFactory = deps.gatewayFactory ?? ((url, token) => new GatewayClient(url, token))
    this.startedAt = this.clock.now()

    // Allow pre-injecting gateway (useful for tests)
    if (deps.gateway) {
      this.gateway = deps.gateway
    }
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

  /** Get the underlying gateway client (for registering invoke handlers) */
  getGateway(): IGatewayClient | null {
    return this.gateway
  }

  /** Set callback for coordinator events (useful for debugging/testing) */
  setOnEvent(callback: (event: CoordinatorEvent) => void): void {
    this.onEvent = callback
  }

  private emit(event: CoordinatorEvent): void {
    this.onEvent?.(event)
  }

  async start(): Promise<void> {
    if (!this.gateway) {
      this.gateway = this.gatewayFactory(this.gatewayUrl, this.gatewayToken)
      await this.gateway.connect()
    }
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
    this.gateway?.disconnect()
    this.gateway = null
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
        // Idle → Sleep after sleepAfterIdleMs (measured from when we became idle)
        const totalInactive = inactiveFor
        const willSleep = totalInactive >= (this.config.idleAfterMs + this.config.sleepAfterIdleMs)
        this.emit({ type: 'sleepCheck', inactiveForMs: totalInactive, willSleep })

        if (willSleep) {
          this.logger.log(`[Coordinator] No activity for ${Math.round(totalInactive / 1000)}s, going to sleep`)
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
    if (!this.gateway?.isConnected()) {
      this.logger.log('[Coordinator] Vibe skipped - gateway not connected')
      this.emit({ type: 'vibeExecuted', skipped: true, reason: 'gateway not connected' })
      this.scheduleNextVibe()
      return
    }

    // Check if session is busy
    if (this.gateway.isSessionBusy()) {
      this.logger.log('[Coordinator] Vibe skipped - session is busy')
      this.emit({ type: 'vibeExecuted', skipped: true, reason: 'session busy' })
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

    try {
      // Agent handles its own speech via the talk tool
      await this.gateway.triggerAgent(this.config.vibePrompt)
    } catch (err) {
      this.logger.error('[Coordinator] Vibe failed:', err)
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

    // Wake up from sleep or idle, reset activity timer
    if (this._state !== 'active') {
      this.wake()
    } else {
      this.resetActivity()
    }

    this.buffer.push(msg)

    // Leading edge: if no timer running, flush immediately and start cooldown
    if (!this.timer) {
      this.flush()
      this.timer = this.clock.setTimeout(() => this.onCooldownEnd(), BATCH_WINDOW_MS)
    }
    // Otherwise, message is buffered and will be flushed when cooldown ends
  }

  private onCooldownEnd(): void {
    this.timer = null

    // If messages accumulated during cooldown, flush them and restart cooldown
    if (this.buffer.length > 0) {
      this.flush()
      this.timer = this.clock.setTimeout(() => this.onCooldownEnd(), BATCH_WINDOW_MS)
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    const batch = this.buffer.splice(0)
    const batchText = this.formatBatch(batch)

    this.logger.log(`[Coordinator] Flushing ${batch.length} messages`)
    this.emit({ type: 'chatProcessed', count: batch.length })

    if (!this.gateway?.isConnected()) {
      this.logger.error('[Coordinator] Gateway not connected, messages lost')
      return
    }

    try {
      // Agent handles its own speech via the talk tool
      await this.gateway.triggerAgent(batchText)
    } catch (err) {
      // Log and continue - don't retry, next batch will work if gateway recovers
      this.logger.error('[Coordinator] Failed to trigger agent:', err)
    }
  }

  formatBatch(messages: ChatMessage[]): string {
    const duration = messages.length > 1
      ? Math.round((this.clock.now() - (messages[0].timestamp ?? this.clock.now())) / 1000)
      : 0

    const header = `[CHAT - ${messages.length} message${messages.length === 1 ? '' : 's'}${duration > 0 ? `, ${duration}s` : ''}]`
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
