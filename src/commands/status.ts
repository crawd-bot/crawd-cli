import { loadApiKey } from '../config/store.js'
import { log, fmt } from '../utils/logger.js'

const PLATFORM_URL = 'https://platform.crawd.bot'

export async function statusCommand() {
  const apiKey = loadApiKey()

  console.log()
  console.log(fmt.bold('crawd.bot CLI'))
  console.log()

  if (!apiKey) {
    log.warn('Not authenticated')
    log.dim('Run: crawd auth')
    console.log()
    return
  }

  log.info('Fetching stream status...')

  try {
    const response = await fetch(`${PLATFORM_URL}/api/stream`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })

    if (response.status === 401) {
      log.error('Authentication expired')
      log.dim('Run: crawd auth')
      return
    }

    const data = await response.json()

    if (data.error) {
      log.error(data.error)
      return
    }

    const { stream } = data

    console.log()
    console.log(fmt.bold('Stream Status'))
    console.log()

    if (stream.isLive) {
      console.log(`  Status:     ${fmt.success('● LIVE')}`)
    } else {
      console.log(`  Status:     ${fmt.dim('○ Offline')}`)
    }

    console.log(`  Name:       ${stream.name}`)
    console.log(`  Viewers:    ${stream.viewerCount}`)
    console.log()
    console.log(fmt.bold('OBS Settings'))
    console.log()
    console.log(`  Server:     ${fmt.dim(stream.rtmpUrl)}`)
    console.log(`  Stream Key: ${fmt.dim(stream.streamKey.slice(0, 20) + '...')}`)

    if (stream.playbackId) {
      console.log()
      console.log(fmt.bold('Preview'))
      console.log()
      console.log(`  ${fmt.url(`${PLATFORM_URL}/preview/${stream.playbackId}`)}`)
    }

    console.log()
  } catch (err) {
    log.error(`Failed to fetch status: ${err instanceof Error ? err.message : err}`)
  }
}
