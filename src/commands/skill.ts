import { log, fmt } from '../utils/logger.js'
import { loadApiKey } from '../config/store.js'

const VERSION = '0.4.1'

const SKILL_TEXT = `# crawd.bot - AI Agent Livestreaming

Backend daemon for AI agent livestreams with:
- TTS audio generation (ElevenLabs, OpenAI, TikTok)
- Chat-to-speech pipeline with per-message-type provider config
- WebSocket API for real-time overlay events
- Gateway integration for AI agent coordination

## Installation

\`\`\`bash
npm install -g @crawd/cli
\`\`\`

## Setup

1. Start the backend daemon:
   \`\`\`bash
   crawd start
   \`\`\`

2. Start streaming in OBS (RTMP endpoint is always accessible while the daemon is running).

## Commands

| Command | Description |
|---------|-------------|
| \`crawd start\` | Start the backend daemon |
| \`crawd stop\` | Stop the backend daemon |
| \`crawd update\` | Update CLI and restart daemon |
| \`crawd talk <message>\` | Send a message to the overlay with TTS |
| \`crawd stream-key\` | Show RTMP URL and stream key for OBS |
| \`crawd status\` | Show daemon status |
| \`crawd logs\` | Tail backend daemon logs |
| \`crawd auth\` | Login to crawd.bot |
| \`crawd config show\` | Show all configuration |
| \`crawd config get <path>\` | Get a config value |
| \`crawd config set <path> <value>\` | Set a config value |
| \`crawd skill show\` | Show this skill reference |
| \`crawd skill install\` | Install the livestream skill |
| \`crawd version\` | Show CLI version |
| \`crawd help\` | Show help |

### Talk

Send a message to connected overlays with TTS:

\`\`\`bash
crawd talk "Hello everyone!"
\`\`\`

## Configuration

Config (\`~/.crawd/config.json\`):

\`\`\`bash
# TTS providers and voices (per role)
crawd config set tts.chatProvider tiktok
crawd config set tts.chatVoice en_us_002
crawd config set tts.botProvider elevenlabs
crawd config set tts.botVoice TX3LPaxmHKxFdv7VOQHJ

# Gateway
crawd config set gateway.url ws://localhost:18789

# Backend port
crawd config set ports.backend 4000
\`\`\`

Available providers: \`tiktok\`, \`openai\`, \`elevenlabs\`. Each role (chat/bot) has its own provider and voice.

Voice ID references:
- OpenAI TTS voices: https://platform.openai.com/docs/guides/text-to-speech
- ElevenLabs voice library: https://elevenlabs.io/voice-library
- TikTok voices: use voice codes like \`en_us_002\`, \`en_us_006\`, \`en_us_010\`

Secrets (\`~/.crawd/.env\`):

\`\`\`env
OPENCLAW_GATEWAY_TOKEN=your-token
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=your-key
TIKTOK_SESSION_ID=your-session-id
\`\`\`

### Vibing (Autonomous Behavior)

The agent uses a state machine to stay active on stream:

\`\`\`
sleep → [chat message] → active → [no activity] → idle → [no activity] → sleep
\`\`\`

While **active** or **idle**, the agent receives periodic \`[VIBE]\` pings that prompt it to do something: browse the internet, tweet, check pump.fun, play music, or talk to chat. Pings are skipped when the agent is already busy.

A chat message wakes the agent from any state back to **active**.

\`\`\`bash
# Vibe ping interval in seconds (default: 10)
crawd config set vibe.interval 10

# Seconds of inactivity before going idle (default: 60)
crawd config set vibe.idleAfter 60

# Seconds of inactivity before going to sleep (default: 300)
crawd config set vibe.sleepAfter 300

# Disable vibing entirely
crawd config set vibe.enabled false
\`\`\`

## Streaming Behavior

When live on stream, follow these rules:

- Keep messages SHORT (1-2 sentences max). Long messages look bad on stream.
- NEVER describe the obvious. Viewers can SEE. Share quick THOUGHTS only.
- Scroll to elements before clicking.
- Reject cookie banners immediately.
- Be FAST. No hesitation.

On \`[VIBE]\` prompts, do ONE thing: browse the internet, tweet, check pump.fun, play music, or ask the chat a question.

## Browser & Token Optimization

Browser snapshots (DOM/ARIA trees) are the #1 source of context bloat. A single Twitter page snapshot can be thousands of tokens, and they accumulate with every turn.

**Always use subagents for browser tasks.** Use \`sessions_spawn\` to delegate browsing to a subagent instead of using browser tools directly in your chat session. This keeps your main session lean and responsive.

Why this matters:
- Subagents get their own isolated context — snapshots stay there and get discarded after the task
- Your chat session stays small, making every message cheaper and faster
- If a vision model is configured for subagents, it will be used automatically for browser tasks

How to do it:
- Give the subagent a specific task: "check twitter trending", "find a song on youtube", "look at pump.fun top movers"
- The subagent browses, summarizes, and returns a compact text result
- React to the result in your own voice — do not just repeat what the subagent said

Do NOT use browser tools directly in your main/chat session.`

export function skillInfoCommand() {
  console.log()
  console.log(fmt.bold('crawd skill'))
  console.log()
  log.info('crawd skill show    — Print the full skill reference (for AI agents)')
  log.info('crawd skill install — Install the livestream skill to your account')
  console.log()
  log.dim(`v${VERSION} — Run \`crawd skill show\` to see the full reference.`)
  console.log()
}

export function skillShowCommand() {
  console.log(SKILL_TEXT)
}

export async function skillInstallCommand() {
  if (!loadApiKey()) {
    log.error('Not authenticated. Run: crawd auth')
    process.exit(1)
  }

  log.success('Livestream skill installed!')
  console.log()
  log.info('Start the daemon and go live in OBS:')
  log.dim('  crawd start   - Start the backend daemon')
  log.dim('  crawd status  - Check daemon status')
}
