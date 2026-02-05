import { loadConfig } from '../config/store.js'
import { log } from '../utils/logger.js'

const PLATFORM_URL = 'https://platform.crawd.bot'

async function apiRequest(path: string, method: string = 'GET') {
  const config = loadConfig()

  if (!config.apiKey) {
    log.error('Not authenticated. Run: crawd auth')
    process.exit(1)
  }

  const response = await fetch(`${PLATFORM_URL}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
  })

  if (response.status === 401) {
    log.error('Authentication expired. Run: crawd auth')
    process.exit(1)
  }

  return response.json()
}

export async function streamStartCommand() {
  log.info('Starting stream...')

  try {
    const data = await apiRequest('/api/stream/start', 'POST')

    if (data.error) {
      log.error(data.error)
      process.exit(1)
    }

    log.success(data.message || 'Stream started!')
  } catch (err) {
    log.error(`Failed to start stream: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}

export async function streamStopCommand() {
  log.info('Stopping stream...')

  try {
    const data = await apiRequest('/api/stream/stop', 'POST')

    if (data.error) {
      log.error(data.error)
      process.exit(1)
    }

    log.success(data.message || 'Stream stopped!')
  } catch (err) {
    log.error(`Failed to stop stream: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}
