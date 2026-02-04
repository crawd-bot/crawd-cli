import { spawn, type ChildProcess } from 'child_process'
import {
  existsSync,
  mkdirSync,
  createWriteStream,
  cpSync,
  readFileSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import {
  LOGS_DIR,
  LOG_FILES,
  OVERLAY_DIR,
  OVERLAY_TEMPLATE_DIR,
  BACKEND_DIR,
  BACKEND_TEMPLATE_DIR,
  CRAWD_HOME,
  ENV_PATH,
  TTS_CACHE_DIR,
} from '../utils/paths.js'
import { log } from '../utils/logger.js'
import { writePid, killProcess, isRunning, type ProcessName } from './pid.js'
import { loadConfig } from '../config/store.js'

/** Ensure all required directories exist */
export function ensureDirectories() {
  const dirs = [CRAWD_HOME, LOGS_DIR, OVERLAY_DIR, BACKEND_DIR, TTS_CACHE_DIR]
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }
}

/** Copy overlay template to user directory if needed */
export function ensureOverlay(force = false) {
  if (force || !existsSync(join(OVERLAY_DIR, 'package.json'))) {
    log.info('Setting up overlay...')

    if (!existsSync(OVERLAY_TEMPLATE_DIR)) {
      throw new Error(
        `Overlay template not found at ${OVERLAY_TEMPLATE_DIR}. ` +
        'This is a bug in the crawd package.'
      )
    }

    cpSync(OVERLAY_TEMPLATE_DIR, OVERLAY_DIR, { recursive: true })
    log.success('Overlay installed to ' + OVERLAY_DIR)
    return true
  }
  return false
}

/** Copy backend template to user directory if needed */
export function ensureBackend(force = false) {
  if (force || !existsSync(join(BACKEND_DIR, 'index.ts'))) {
    log.info('Setting up backend...')

    if (!existsSync(BACKEND_TEMPLATE_DIR)) {
      throw new Error(
        `Backend template not found at ${BACKEND_TEMPLATE_DIR}. ` +
        'This is a bug in the crawd package.'
      )
    }

    cpSync(BACKEND_TEMPLATE_DIR, BACKEND_DIR, { recursive: true })

    // Create a minimal package.json for the backend
    const backendPkg = {
      name: '@crawd/backend',
      type: 'module',
      private: true,
      dependencies: {
        '@fastify/cors': '^10.0.2',
        '@fastify/static': '^8.1.0',
        'dotenv': '^16.4.7',
        'fastify': '^5.2.1',
        'socket.io': '^4.8.1',
      },
      optionalDependencies: {
        'openai': '^4.77.0',
        '@elevenlabs/elevenlabs-js': '^1.0.0',
      },
    }

    writeFileSync(
      join(BACKEND_DIR, 'package.json'),
      JSON.stringify(backendPkg, null, 2)
    )

    log.success('Backend installed to ' + BACKEND_DIR)
    return true
  }
  return false
}

/** Check if backend dependencies are installed */
function backendHasNodeModules(): boolean {
  return existsSync(join(BACKEND_DIR, 'node_modules'))
}

/** Install backend dependencies */
async function installBackendDeps(): Promise<void> {
  log.info('Installing backend dependencies...')

  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['install'], {
      cwd: BACKEND_DIR,
      stdio: 'inherit',
    })

    child.on('close', (code) => {
      if (code === 0) {
        log.success('Backend dependencies installed')
        resolve()
      } else {
        reject(new Error(`pnpm install failed with code ${code}`))
      }
    })

    child.on('error', reject)
  })
}

/** Check if overlay dependencies are installed */
function overlayHasNodeModules(): boolean {
  return existsSync(join(OVERLAY_DIR, 'node_modules'))
}

/** Install overlay dependencies */
async function installOverlayDeps(): Promise<void> {
  log.info('Installing overlay dependencies...')

  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['install'], {
      cwd: OVERLAY_DIR,
      stdio: 'inherit',
    })

    child.on('close', (code) => {
      if (code === 0) {
        log.success('Overlay dependencies installed')
        resolve()
      } else {
        reject(new Error(`pnpm install failed with code ${code}`))
      }
    })

    child.on('error', reject)
  })
}

/** Build environment variables for child processes */
function buildEnv(): NodeJS.ProcessEnv {
  const config = loadConfig()
  const env: NodeJS.ProcessEnv = { ...process.env }

  // Load from .env file if exists
  if (existsSync(ENV_PATH)) {
    const content = readFileSync(ENV_PATH, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) continue
      const key = trimmed.slice(0, eqIndex).trim()
      let value = trimmed.slice(eqIndex + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      env[key] = value
    }
  }

  // Add config-derived values
  env.CRAWD_GATEWAY_URL = config.gateway.url
  if (config.gateway.token) {
    env.CRAWD_GATEWAY_TOKEN = config.gateway.token
  }
  env.CRAWD_CHANNEL_ID = config.gateway.channelId
  env.CRAWD_BACKEND_PORT = String(config.ports.backend)
  env.CRAWD_OVERLAY_PORT = String(config.ports.overlay)

  return env
}

/** Start a daemon process */
function startDaemon(
  name: ProcessName,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): ChildProcess {
  // Ensure log directory exists
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true })
  }

  const logStream = createWriteStream(LOG_FILES[name], { flags: 'a' })

  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', logStream, logStream],
  })

  child.unref()

  if (child.pid) {
    writePid(name, child.pid)
  }

  return child
}

/** Start the backend server */
export async function startBackend(): Promise<ChildProcess | null> {
  if (isRunning('backend')) {
    log.warn('Backend is already running')
    return null
  }

  // Ensure backend is set up
  ensureBackend()

  // Install dependencies if needed
  if (!backendHasNodeModules()) {
    await installBackendDeps()
  }

  const config = loadConfig()
  const env = buildEnv()

  // Set TTS directory
  env.CRAWD_TTS_DIR = TTS_CACHE_DIR

  const backendEntry = join(BACKEND_DIR, 'index.ts')

  log.info(`Starting backend on port ${config.ports.backend}...`)
  return startDaemon('backend', 'npx', ['tsx', backendEntry], BACKEND_DIR, env)
}

/** Start the overlay dev server */
export async function startOverlay(): Promise<ChildProcess | null> {
  if (isRunning('overlay')) {
    log.warn('Overlay is already running')
    return null
  }

  ensureOverlay()

  if (!overlayHasNodeModules()) {
    await installOverlayDeps()
  }

  const config = loadConfig()
  const env = buildEnv()

  // Set Vite port
  env.PORT = String(config.ports.overlay)

  log.info(`Starting overlay on port ${config.ports.overlay}...`)
  return startDaemon('overlay', 'pnpm', ['dev'], OVERLAY_DIR, env)
}

/** Stop a specific daemon */
export function stopDaemon(name: ProcessName): boolean {
  if (!isRunning(name)) {
    log.dim(`${name} is not running`)
    return false
  }

  const killed = killProcess(name)
  if (killed) {
    log.success(`Stopped ${name}`)
  }
  return killed
}

/** Stop all daemons */
export function stopAll() {
  stopDaemon('backend')
  stopDaemon('overlay')
}

/** Start all daemons */
export async function startAll() {
  ensureDirectories()

  const backend = await startBackend()
  const overlay = await startOverlay()

  return { backend, overlay }
}
