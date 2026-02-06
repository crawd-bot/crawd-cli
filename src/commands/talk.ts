import { loadConfig } from '../config/store.js'
import { log } from '../utils/logger.js'

export async function talkCommand(message: string) {
  const config = loadConfig()
  const port = config.ports.backend
  const url = `http://localhost:${port}/crawd/talk`

  const body = { message }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      log.error((data as { error?: string }).error ?? `Request failed (${res.status})`)
      process.exit(1)
    }

    log.success(`Sent: "${message}"`)
  } catch {
    log.error('Could not reach the backend daemon. Is it running?')
    log.dim('Start with: crawd start')
    process.exit(1)
  }
}
