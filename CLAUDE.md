# crawd-cli

AI agent livestreaming platform. OpenClaw plugin + CLI that lets autonomous AI agents stream on Twitch/YouTube with real-time chat interaction, TTS voice, and OBS overlays.

## CLAUDE.md Management

Keep this file up to date. When you discover new patterns, deployment steps, gotchas, or architectural decisions during a session, proactively suggest updating CLAUDE.md before the session ends. This file is the single source of truth across sessions — if something caused confusion or wasted time, document it here so it doesn't happen again.

## Architecture

**OpenClaw Plugin** (`src/plugin.ts`) — Primary integration point. Registers two tools:
- `livestream_talk` — Unprompted speech (narration, vibes, commentary)
- `livestream_reply` — Reply to a chat message (plays original then bot reply)

**CrawdBackend** (`src/backend/server.ts`) — Fastify + Socket.IO server. Handles chat integration, overlay events (text-only), and the coordinator state machine. Started as a background service when the plugin is loaded by OpenClaw. TTS generation has been moved to the overlay (Next.js server actions).

**Coordinator** (`src/backend/coordinator.ts`) — Autonomous state machine (sleep → idle → active). Manages vibe loop, chat batching (configurable, default 20s window, leading-edge throttle), and gateway WebSocket connection.

**CLI** (`src/cli.ts`) — Commander.js commands: `auth`, `start`, `stop`, `talk`, `status`, `logs`, `config`, `stream-key`, `skill`, `update`.

## Key Data Flow

```
Chat (YouTube/PumpFun) → ChatManager → Coordinator batches → Gateway → Agent
Agent uses livestream_reply/talk → CrawdBackend emits text-only event → Socket.IO → Overlay
Overlay generates TTS (server action) → plays audio → emits crawd:talk:done → Backend resolves tool call
```

## Project Structure

```
src/
  cli.ts              # CLI entry point (commander)
  plugin.ts           # OpenClaw plugin registration & tools
  types.ts            # Shared event types (backend ↔ overlay)
  client.ts           # Overlay client SDK (Socket.IO wrapper)
  backend/
    server.ts         # CrawdBackend class (Fastify + Socket.IO)
    coordinator.ts    # State machine, vibe loop, gateway client
    index.ts          # Standalone backend entry (for direct `bun run`)
  commands/           # CLI command implementations
  config/
    schema.ts         # Zod config schema
    store.ts          # ~/.crawd/config.json & .env management
  lib/
    chat/             # Chat platform adapters (YouTube, PumpFun)
    pumpfun/          # PumpFun token data & market cap
    tts/              # (TTS moved to overlay — this dir may be empty)
  daemon/             # Daemon lifecycle & PID management
  utils/              # Paths (~/.crawd/*), logger
skills/crawd/         # Agent behavior guidelines (SKILL.md)
.claude/commands/     # Project-local slash commands (/deploy)
openclaw.plugin.json  # Plugin manifest with configSchema & uiHints
```

## Socket.IO Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `crawd:talk` | backend → overlay | `TalkEvent` (id, message — text only) |
| `crawd:talk:done` | overlay → backend | `TalkDoneEvent` (id) — ack after TTS/display finished |
| `crawd:reply-turn` | backend → overlay | `ReplyTurnEvent` (id, chat, botMessage — text only) |
| `crawd:chat` | backend → overlay | `ChatMessage` (raw chat, no TTS) |
| `crawd:mcap` | backend → overlay | `McapEvent` (market cap update) |
| `crawd:status` | backend → overlay | `StatusEvent` (coordinator state) |

## TTS

TTS has been moved to the overlay (crawd-overlay-example). The backend sends text-only events. The overlay generates TTS via Next.js server actions and manages audio playback + ack flow. See the overlay project for TTS provider configuration.

## Remote Deployment (Mac Mini)

Production runs on a Mac Mini at `m1@62.210.193.35`. Use `/deploy` to automate.

**What runs on remote:**
- **OpenClaw Gateway** (`openclaw gateway run --port 18789`) — the agent runtime
- **crawd plugin** — installed at `~/openclaw-plugins/node_modules/crawd`, loaded by gateway via `~/.openclaw/openclaw.json`
- **crawd-overlay-example** — Next.js dev server at `~/crawd-overlay-example` (serves OBS browser source)

**Config:** Plugin config (vibe settings, chat sources) lives in `~/.openclaw/openclaw.json` under `plugins.entries.crawd.config`. TTS config lives in the overlay's `.env.local` (not in the plugin config).

**SSH note:** `openclaw` is installed globally via npm at `/usr/local/bin`. Use `openclaw gateway restart --port 18789` to restart. pnpm is at `/opt/homebrew/bin` so prefix with `export PATH=/opt/homebrew/bin:$PATH` when running pnpm commands.

## Runtime Config (Coordinator)

The coordinator exposes HTTP endpoints on the backend port (default 4000):

- `GET /coordinator/status` — current state + config
- `POST /coordinator/config` — update at runtime (body: partial `CoordinatorConfig`)

Configurable fields (all in ms when sent via HTTP, seconds in config schema):

| Field | Config key | Default | Description |
|-------|-----------|---------|-------------|
| `vibeIntervalMs` | `vibe.interval` | 30s | Time between vibe pings |
| `idleAfterMs` | `vibe.idleAfter` | 180s | Inactivity before idle |
| `sleepAfterIdleMs` | `vibe.sleepAfter` | 360s | Idle time before sleep |
| `batchWindowMs` | `vibe.chatBatchWindow` | 20s | Chat batch throttle window |
| `vibeEnabled` | `vibe.enabled` | true | Toggle autonomous vibing |

## Development

```bash
pnpm dev           # Run CLI with tsx
pnpm build         # Build CLI + exports (tsup)
pnpm build:all     # Full build (CLI + backend)
pnpm typecheck     # tsc --noEmit
```

- Runtime: Node.js >= 18
- ESM modules, TypeScript strict mode
- Published to npm as `crawd` — overlay and remote plugin install from npm
- Config: `~/.crawd/config.json` (Zod-validated), `~/.crawd/.env` (secrets)
- Logs: `~/.crawd/logs/crawdbot.log`, PID: `~/.crawd/pids/crawdbot.pid`

## Conventions

- Use `type` not `interface` (unless OOP class contract)
- Use pnpm for package management
- Zod for runtime config validation
- EventEmitter pattern for client lifecycle
- Exponential backoff for all reconnection logic
- `@sinclair/typebox` for tool parameter schemas (OpenClaw plugin API)
