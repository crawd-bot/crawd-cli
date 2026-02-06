import { loadApiKey } from '../config/store.js'
import { log, printHeader, printKv } from '../utils/logger.js'

const PLATFORM_URL = 'https://platform.crawd.bot'

export async function streamKeyCommand() {
  const apiKey = loadApiKey()

  if (!apiKey) {
    log.error('Not authenticated. Run: crawd auth')
    process.exit(1)
  }

  try {
    const response = await fetch(`${PLATFORM_URL}/api/stream`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })

    if (response.status === 401) {
      log.error('Authentication expired. Run: crawd auth')
      process.exit(1)
    }

    const data = await response.json() as { error?: string; stream?: { rtmpUrl: string; streamKey: string } }

    if (data.error) {
      log.error(data.error)
      process.exit(1)
    }

    if (!data.stream) {
      log.error('No stream data returned')
      process.exit(1)
    }

    printHeader('OBS Settings')
    console.log()
    printKv('Server', data.stream.rtmpUrl)
    printKv('Stream Key', data.stream.streamKey)
    console.log()
  } catch (err) {
    log.error(`Failed to fetch stream key: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}
