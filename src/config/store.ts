import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { CONFIG_PATH, CRAWD_HOME, ENV_PATH } from '../utils/paths.js'
import { Config, ConfigSchema, DEFAULT_CONFIG } from './schema.js'

/** Ensure the crawd home directory exists */
export function ensureHome() {
  if (!existsSync(CRAWD_HOME)) {
    mkdirSync(CRAWD_HOME, { recursive: true })
  }
}

/** Load configuration from disk */
export function loadConfig(): Config {
  ensureHome()

  if (!existsSync(CONFIG_PATH)) {
    return DEFAULT_CONFIG
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    return ConfigSchema.parse(parsed)
  } catch (e) {
    console.warn('Failed to parse config, using defaults:', e)
    return DEFAULT_CONFIG
  }
}

/** Save configuration to disk */
export function saveConfig(config: Config) {
  ensureHome()
  const dir = dirname(CONFIG_PATH)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

/** Update specific config values (deep merge) */
export function updateConfig(updates: Partial<Config>) {
  const current = loadConfig()
  const merged = deepMerge(current, updates)
  const validated = ConfigSchema.parse(merged)
  saveConfig(validated)
  return validated
}

/** Get a specific config value by dot-notation path */
export function getConfigValue(path: string): unknown {
  const config = loadConfig()
  return getByPath(config, path)
}

/** Set a specific config value by dot-notation path */
export function setConfigValue(path: string, value: unknown) {
  const config = loadConfig()
  setByPath(config, path, value)
  const validated = ConfigSchema.parse(config)
  saveConfig(validated)
  return validated
}

/** Load secrets from ~/.crawd/.env */
export function loadEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {}

  const content = readFileSync(ENV_PATH, 'utf-8')
  const env: Record<string, string> = {}

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

  return env
}

/** Save secrets to ~/.crawd/.env */
export function saveEnv(env: Record<string, string>) {
  ensureHome()
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`)
  writeFileSync(ENV_PATH, lines.join('\n') + '\n')
}

/** Load API key from ~/.crawd/.env */
export function loadApiKey(): string | null {
  const env = loadEnv()
  return env.CRAWD_API_KEY ?? null
}

/** Known .env keys — included with empty defaults so users can see what's available */
const ENV_TEMPLATE_KEYS = [
  'CRAWD_API_KEY',
  'OPENAI_API_KEY',
  'ELEVENLABS_API_KEY',
  'TIKTOK_SESSION_ID',
  'OPENCLAW_GATEWAY_TOKEN',
]

/** Save API key to ~/.crawd/.env, seeding empty placeholders for known keys */
export function saveApiKey(apiKey: string) {
  const env = loadEnv()
  for (const key of ENV_TEMPLATE_KEYS) {
    if (!(key in env)) env[key] = ''
  }
  env.CRAWD_API_KEY = apiKey
  saveEnv(env)
}

// Helper functions

function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target }
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceVal = source[key]
    const targetVal = target[key]

    if (
      sourceVal !== undefined &&
      typeof sourceVal === 'object' &&
      sourceVal !== null &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      targetVal !== null
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      ) as T[keyof T]
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[keyof T]
    }
  }
  return result
}

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current = obj
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function setByPath(obj: unknown, path: string, value: unknown) {
  const parts = path.split('.')
  let current = obj as Record<string, unknown>
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}
