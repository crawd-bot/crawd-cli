import { spawn } from 'child_process'
import { existsSync, openSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { isRunning, writePid } from '../daemon/pid.js'
import { log, fmt, printHeader, printKv } from '../utils/logger.js'
import { LOGS_DIR, LOG_FILES, PIDS_DIR } from '../utils/paths.js'
import { loadConfig, loadEnv } from '../config/store.js'
import type { Config } from '../config/schema.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** Resolve the backend entry point (src/backend/index.ts relative to package root) */
function getBackendEntry(): string {
  // From src/commands/ (dev with tsx)
  const fromSrc = join(__dirname, '..', 'backend', 'index.ts')
  if (existsSync(fromSrc)) return fromSrc

  // From dist/ (built cli.js)
  const fromDist = join(__dirname, '..', 'src', 'backend', 'index.ts')
  if (existsSync(fromDist)) return fromDist

  throw new Error('Backend entry point not found')
}

/** Build env vars from config + secrets for the backend process */
function buildEnv(config: Config): NodeJS.ProcessEnv {
  const secrets = loadEnv()
  const env: NodeJS.ProcessEnv = { ...process.env }

  // Secrets from ~/.crawd/.env
  for (const [key, value] of Object.entries(secrets)) {
    env[key] = value
  }

  // Config from ~/.crawd/config.json
  env.PORT = String(config.ports.backend)
  env.BACKEND_URL = `http://localhost:${config.ports.backend}`
  env.OPENCLAW_GATEWAY_URL = config.gateway.url
  env.CRAWD_CHANNEL_ID = config.gateway.channelId
  env.TTS_CHAT_PROVIDER = config.tts.chatProvider
  env.TTS_CHAT_VOICE = config.tts.chatVoice
  env.TTS_BOT_PROVIDER = config.tts.botProvider
  env.TTS_BOT_VOICE = config.tts.botVoice
  if (config.chat.pumpfun) {
    env.PUMPFUN_ENABLED = String(config.chat.pumpfun.enabled)
    if (config.chat.pumpfun.tokenMint) {
      env.NEXT_PUBLIC_TOKEN_MINT = config.chat.pumpfun.tokenMint
    }
  }
  env.YOUTUBE_ENABLED = String(config.chat.youtube.enabled)
  if (config.chat.youtube.videoId) {
    env.YOUTUBE_VIDEO_ID = config.chat.youtube.videoId
  }

  return env
}

export async function startCommand() {
  if (isRunning('crawdbot')) {
    const config = loadConfig()
    log.warn('Backend is already running')
    printKv('Backend', fmt.url(`http://localhost:${config.ports.backend}`))
    log.dim('Use `crawd stop` to stop it first')
    return
  }

  const backendEntry = getBackendEntry()

  // Ensure dirs
  for (const dir of [LOGS_DIR, PIDS_DIR]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  const config = loadConfig()
  const env = buildEnv(config)

  log.info('Starting CrawdBot backend...')

  const logFd = openSync(LOG_FILES.crawdbot, 'a')

  const child = spawn('bun', ['run', backendEntry], {
    cwd: join(dirname(backendEntry), '..', '..'),
    env,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  })

  child.unref()

  if (child.pid) {
    writePid('crawdbot', child.pid)
  }

  // Wait for it to start
  await new Promise((r) => setTimeout(r, 1500))

  if (isRunning('crawdbot')) {
    printHeader('CrawdBot started')
    console.log()
    log.success(`Backend running (PID ${child.pid})`)
    printKv('Backend', fmt.url(`http://localhost:${config.ports.backend}`))
    console.log()
    log.dim('View logs: crawd logs')
    log.dim('Stop: crawd stop')
  } else {
    log.error('Backend failed to start')
    log.dim(`Check logs: tail ${LOG_FILES.crawdbot}`)
    process.exit(1)
  }
}
