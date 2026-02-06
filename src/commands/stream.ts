import { loadApiKey } from '../config/store.js'
import { log, fmt, printHeader, printKv } from '../utils/logger.js'

const PLATFORM_URL = 'https://platform.crawd.bot'

async function apiRequest(path: string, method: string = 'GET') {
  const apiKey = loadApiKey()

  if (!apiKey) {
    log.error('Not authenticated. Run: crawd auth')
    process.exit(1)
  }

  const response = await fetch(`${PLATFORM_URL}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })

  if (response.status === 401) {
    log.error('Authentication expired. Run: crawd auth')
    process.exit(1)
  }

  return response.json()
}

async function showOBSSettings() {
  try {
    const data = await apiRequest('/api/stream')
    if (data?.stream) {
      const { stream } = data
      printHeader('OBS Settings')
      console.log()
      printKv('Server', fmt.dim(stream.rtmpUrl))
      printKv('Stream Key', stream.streamKey)
      console.log()
    }
  } catch {
    // Non-critical — stream started fine, just couldn't fetch settings
  }
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
    await showOBSSettings()
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
