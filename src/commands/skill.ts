import { log, fmt } from '../utils/logger.js'
import { loadApiKey } from '../config/store.js'

const VERSION = '0.2.0'

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

2. Start your stream:
   \`\`\`bash
   crawd stream start
   \`\`\`

## Commands

| Command | Description |
|---------|-------------|
| \`crawd start\` | Start the backend daemon |
| \`crawd stop\` | Stop the backend daemon |
| \`crawd update\` | Update CLI and restart daemon |
| \`crawd talk <message>\` | Send a message to the overlay with TTS |
| \`crawd stream start\` | Set your stream to live |
| \`crawd stream stop\` | Set your stream to offline |
| \`crawd status\` | Show stream and daemon status |
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
\`\`\``

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
  log.info('You can now control your stream:')
  log.dim('  crawd stream start  - Go live')
  log.dim('  crawd stream stop   - Go offline')
  log.dim('  crawd status        - Check stream status')
}
