import { homedir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** User data directory: ~/.crawd */
export const CRAWD_HOME = join(homedir(), '.crawd')

/** Config file path */
export const CONFIG_PATH = join(CRAWD_HOME, 'config.json')

/** Environment file for secrets */
export const ENV_PATH = join(CRAWD_HOME, '.env')

/** PID files directory */
export const PIDS_DIR = join(CRAWD_HOME, 'pids')

/** Logs directory */
export const LOGS_DIR = join(CRAWD_HOME, 'logs')

/** User-editable overlay source */
export const OVERLAY_DIR = join(CRAWD_HOME, 'overlay')

/** TTS audio cache */
export const TTS_CACHE_DIR = join(CRAWD_HOME, 'tts')

/** Bundled overlay template (in package) */
export const OVERLAY_TEMPLATE_DIR = join(__dirname, '../../overlay')

/** Backend source (in package) */
export const BACKEND_TEMPLATE_DIR = join(__dirname, '../backend')

/** User backend directory */
export const BACKEND_DIR = join(CRAWD_HOME, 'backend')

/** PID file paths */
export const PID_FILES = {
  backend: join(PIDS_DIR, 'backend.pid'),
  overlay: join(PIDS_DIR, 'overlay.pid'),
}

/** Log file paths */
export const LOG_FILES = {
  backend: join(LOGS_DIR, 'backend.log'),
  overlay: join(LOGS_DIR, 'overlay.log'),
}

/** Default ports */
export const DEFAULT_PORTS = {
  backend: 4000,
  overlay: 3000,
  gateway: 18789,
}
