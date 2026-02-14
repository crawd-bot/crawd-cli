/**
 * OpenClaw plugin entry point for crawd.
 *
 * Registers:
 * - `livestream_talk` tool (unprompted speech on stream)
 * - `livestream_reply` tool (reply to a chat message)
 * - `crawd` service (Fastify + Socket.IO backend)
 */
import { Type } from '@sinclair/typebox'
import { CrawdBackend, type CrawdConfig } from './backend/server.js'

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

/** Resolve gateway WebSocket URL from env/defaults (same logic as OpenClaw's callGateway) */
function resolveGatewayUrl(port?: number): string {
  if (port) return `ws://127.0.0.1:${port}`
  const portRaw = process.env.OPENCLAW_GATEWAY_PORT?.trim()
  const resolved = portRaw ? parseInt(portRaw, 10) || 18789 : 18789
  return `ws://127.0.0.1:${resolved}`
}

/**
 * Read gateway auth + port from the OpenClaw host config.
 * The real PluginApi has a `config: OpenClawConfig` property — our minimal
 * inline type omits it so we access it via casting.
 */
function resolveGatewayFromHost(api: PluginApi): { token?: string; port?: number } {
  const oclConfig = (api as Record<string, unknown>).config as Record<string, unknown> | undefined
  if (!oclConfig) return {}
  const gw = (oclConfig.gateway ?? {}) as Record<string, unknown>
  const auth = (gw.auth ?? {}) as Record<string, unknown>
  return {
    token: typeof auth.token === 'string' ? auth.token : undefined,
    port: typeof gw.port === 'number' ? gw.port : undefined,
  }
}

function parsePluginConfig(raw: Record<string, unknown> | undefined): CrawdConfig {
  const cfg = raw ?? {}
  const vibe = (cfg.vibe ?? {}) as Record<string, unknown>
  const chat = (cfg.chat ?? {}) as Record<string, unknown>
  const youtube = (chat.youtube ?? {}) as Record<string, unknown>
  const pumpfun = (chat.pumpfun ?? {}) as Record<string, unknown>

  const port = typeof cfg.port === 'number' ? cfg.port : 4000

  return {
    enabled: cfg.enabled !== false,
    port,
    bindHost: typeof cfg.bindHost === 'string' ? cfg.bindHost : '0.0.0.0',
    vibe: {
      enabled: vibe.enabled !== false,
      intervalMs: typeof vibe.intervalMs === 'number' ? vibe.intervalMs : 10_000,
      idleAfterMs: typeof vibe.idleAfterMs === 'number' ? vibe.idleAfterMs : 30_000,
      sleepAfterIdleMs: typeof vibe.sleepAfterIdleMs === 'number' ? vibe.sleepAfterIdleMs : 60_000,
      batchWindowMs: typeof vibe.batchWindowMs === 'number' ? vibe.batchWindowMs : 20_000,
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
    // Autonomy mode: vibe (periodic prompts), plan (goal-driven), none (disabled)
    autonomyMode: cfg.autonomyMode === 'vibe' || cfg.autonomyMode === 'plan' || cfg.autonomyMode === 'none'
      ? cfg.autonomyMode
      : undefined,
    // Gateway: plugin config overrides, then env vars, then OpenClaw defaults
    gatewayUrl: typeof cfg.gatewayUrl === 'string' ? cfg.gatewayUrl
      : process.env.OPENCLAW_GATEWAY_URL ?? resolveGatewayUrl(),
    gatewayToken: typeof cfg.gatewayToken === 'string' ? cfg.gatewayToken
      : process.env.OPENCLAW_GATEWAY_TOKEN,
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
    'autonomyMode': { label: 'Autonomy Mode', help: 'vibe = timed prompts, plan = goal-driven loop, none = disabled' },
    'vibe.enabled': { label: 'Vibe Mode' },
    'vibe.intervalMs': { label: 'Vibe Interval (ms)', advanced: true },
    'vibe.idleAfterMs': { label: 'Idle After (ms)', advanced: true },
    'vibe.sleepAfterIdleMs': { label: 'Sleep After Idle (ms)', advanced: true },
    'vibe.batchWindowMs': { label: 'Chat Batch Window (ms)', advanced: true },
    'vibe.prompt': { label: 'Vibe Prompt', advanced: true },
    'chat.youtube.enabled': { label: 'YouTube Chat' },
    'chat.youtube.videoId': { label: 'YouTube Video ID' },
    'chat.pumpfun.enabled': { label: 'PumpFun Chat' },
    'chat.pumpfun.tokenMint': { label: 'PumpFun Token Mint' },
    'chat.pumpfun.authToken': { label: 'PumpFun Auth Token', sensitive: true },
    gatewayUrl: { label: 'Gateway URL', help: 'WebSocket URL for agent triggering', advanced: true },
    gatewayToken: { label: 'Gateway Token', sensitive: true },
  },
}

const plugin: PluginDefinition = {
  id: 'crawd',
  name: 'Crawd Livestream',
  description: 'crawd.bot plugin — AI agent livestreaming with chat integration and OBS overlay',
  configSchema: crawdConfigSchema,

  register(api: PluginApi) {
    const config = parsePluginConfig(api.pluginConfig)
    if (!config.enabled) {
      api.logger.info('crawd: disabled')
      return
    }

    // Resolve gateway auth from OpenClaw host config (token lives there, not in env)
    const hostGw = resolveGatewayFromHost(api)
    if (!config.gatewayToken && hostGw.token) {
      config.gatewayToken = hostGw.token
      api.logger.info('crawd: resolved gateway token from host config')
    }
    if (hostGw.port && !process.env.OPENCLAW_GATEWAY_PORT) {
      config.gatewayUrl = resolveGatewayUrl(hostGw.port)
    }

    api.logger.info(`crawd: gateway url=${config.gatewayUrl}, token=${config.gatewayToken ? 'set' : '(none — gateway may not require auth in local mode)'}`)

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
          'Speak on the livestream unprompted. Shows a speech bubble on the overlay. Use for narration, vibes, and commentary — NOT for replying to chat (use livestream_reply for that).',
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
          'Reply to a chat message on the livestream. Shows the original message and your reply on the overlay. Use this ONLY when responding to a specific viewer message.',
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

    // plan_set — create or replace current plan
    api.registerTool(
      {
        name: 'plan_set',
        label: 'Set Plan',
        description:
          'Create or replace the current plan. Provide a goal and ordered steps. Any existing active plan is abandoned.',
        parameters: Type.Object({
          goal: Type.String({ description: 'The overall goal of the plan' }),
          steps: Type.Array(Type.String(), { description: 'Ordered list of steps to accomplish the goal', minItems: 1, maxItems: 20 }),
        }),
        async execute(_toolCallId: string, params: unknown) {
          const b = await ensureBackend()
          const { goal, steps } = params as { goal: string; steps: string[] }
          const result = b.setPlan(goal, steps)
          if ('error' in result) {
            return { content: [{ type: 'text', text: `Failed: ${result.error}` }] }
          }
          const stepList = result.plan.steps.map((s, i) => `  ${i}. ${s.description}`).join('\n')
          return {
            content: [{ type: 'text', text: `Plan created: ${goal}\n${stepList}` }],
            details: result,
          }
        },
      },
      { name: 'plan_set' },
    )

    // plan_step_done — mark a step as complete
    api.registerTool(
      {
        name: 'plan_step_done',
        label: 'Plan Step Done',
        description:
          'Mark a plan step as done by its 0-based index. The coordinator will nudge you for the next step.',
        parameters: Type.Object({
          step: Type.Number({ description: 'Zero-based index of the step to mark as done' }),
        }),
        async execute(_toolCallId: string, params: unknown) {
          const b = await ensureBackend()
          const { step } = params as { step: number }
          const result = b.markPlanStepDone(step)
          if ('error' in result) {
            return { content: [{ type: 'text', text: `Failed: ${result.error}` }] }
          }
          const done = result.plan.steps.filter(s => s.status === 'done').length
          const total = result.plan.steps.length
          const isComplete = result.plan.status === 'completed'
          return {
            content: [{ type: 'text', text: isComplete
              ? `Plan completed! All ${total} steps done.`
              : `Step ${step} done (${done}/${total} complete).`
            }],
            details: result,
          }
        },
      },
      { name: 'plan_step_done' },
    )

    // plan_abandon — abandon current plan
    api.registerTool(
      {
        name: 'plan_abandon',
        label: 'Abandon Plan',
        description:
          'Abandon the current plan. The coordinator will stop sending plan nudges.',
        parameters: Type.Object({}),
        async execute(_toolCallId: string, _params: unknown) {
          const b = await ensureBackend()
          const result = b.abandonPlan()
          if ('error' in result) {
            return { content: [{ type: 'text', text: `Failed: ${result.error}` }] }
          }
          return {
            content: [{ type: 'text', text: `Plan abandoned: ${result.plan.goal}` }],
            details: result,
          }
        },
      },
      { name: 'plan_abandon' },
    )

    // plan_get — view current plan state
    api.registerTool(
      {
        name: 'plan_get',
        label: 'Get Plan',
        description:
          'View the current plan state including goal, steps, and progress.',
        parameters: Type.Object({}),
        async execute(_toolCallId: string, _params: unknown) {
          const b = await ensureBackend()
          const result = b.getPlan()
          if (!result.plan) {
            return { content: [{ type: 'text', text: 'No active plan.' }] }
          }
          const p = result.plan
          const stepList = p.steps.map((s, i) => {
            const marker = s.status === 'done' ? '[x]' : '[ ]'
            return `  ${marker} ${i}. ${s.description}`
          }).join('\n')
          return {
            content: [{ type: 'text', text: `Plan (${p.status}): ${p.goal}\n${stepList}` }],
            details: result,
          }
        },
      },
      { name: 'plan_get' },
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
