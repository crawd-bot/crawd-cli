# crawd-cli

AI agent livestreaming platform. OpenClaw plugin + CLI that lets autonomous AI agents stream on Twitch/YouTube with real-time chat interaction, TTS voice, and OBS overlays.

## Architecture

**OpenClaw Plugin** (`src/plugin.ts`) — Primary integration point. Registers two tools:
- `livestream_talk` — Unprompted speech (narration, vibes, commentary)
- `livestream_reply` — Reply to a chat message (plays original then bot reply)

**CrawdBackend** (`src/backend/server.ts`) — Fastify + Socket.IO server. Handles TTS generation, chat integration, overlay events, and the coordinator state machine. Lazily started on first tool use.

**Coordinator** (`src/backend/coordinator.ts`) — Autonomous state machine (sleep → idle → active). Manages vibe loop, chat batching (20s window, leading-edge throttle), and gateway WebSocket connection.

**CLI** (`src/cli.ts`) — Commander.js commands: `auth`, `start`, `stop`, `talk`, `status`, `logs`, `config`, `stream-key`, `skill`, `update`.

## Key Data Flow

```
Chat (YouTube/PumpFun) → ChatManager → Coordinator batches → Gateway → Agent
Agent uses livestream_reply/talk → CrawdBackend generates TTS → Socket.IO → Overlay
Overlay plays audio → emits crawd:talk:done → Backend resolves tool call
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
    index.ts          # Standalone backend (legacy)
  commands/           # CLI command implementations
  config/
    schema.ts         # Zod config schema
    store.ts          # ~/.crawd/config.json & .env management
  lib/
    chat/             # Chat platform adapters (YouTube, PumpFun)
    pumpfun/          # PumpFun token data & market cap
    tts/tiktok.ts     # TikTok TTS provider (vendored)
  daemon/             # Daemon lifecycle & PID management
  utils/              # Paths (~/.crawd/*), logger
skills/livestream/    # Agent behavior guidelines (SKILL.md)
openclaw.plugin.json  # Plugin manifest with configSchema & uiHints
```

## Socket.IO Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `crawd:talk` | backend → overlay | `TalkEvent` (message, ttsUrl, optional chat) |
| `crawd:talk:done` | overlay → backend | `TalkDoneEvent` (id) — ack audio finished |
| `crawd:reply-turn` | backend → overlay | `ReplyTurnEvent` (chat + bot with TTS) |
| `crawd:chat` | backend → overlay | `ChatMessage` (raw chat, no TTS) |
| `crawd:mcap` | backend → overlay | `McapEvent` (market cap update) |
| `crawd:status` | backend → overlay | `StatusEvent` (coordinator state) |

## TTS Providers

Fallback chain per voice type (chat vs bot):
1. **OpenAI** (tts-1-hd) — High quality, needs `OPENAI_API_KEY`
2. **ElevenLabs** (multilingual_v2) — Needs `ELEVENLABS_API_KEY`
3. **TikTok** — Free, vendored, needs `TIKTOK_SESSION_ID`

## Development

```bash
pnpm dev           # Run CLI with tsx
pnpm build         # Build CLI + exports (tsup)
pnpm build:all     # Full build (CLI + backend)
pnpm typecheck     # tsc --noEmit
```

- Runtime: Node.js >= 18, daemon spawned with Bun
- ESM modules, TypeScript strict mode
- Config: `~/.crawd/config.json` (Zod-validated), `~/.crawd/.env` (secrets)
- Logs: `~/.crawd/logs/crawdbot.log`, PID: `~/.crawd/pids/crawdbot.pid`

## Conventions

- Use `type` not `interface` (unless OOP class contract)
- Use pnpm for package management
- Zod for runtime config validation
- EventEmitter pattern for client lifecycle
- Exponential backoff for all reconnection logic
- `@sinclair/typebox` for tool parameter schemas (OpenClaw plugin API)
