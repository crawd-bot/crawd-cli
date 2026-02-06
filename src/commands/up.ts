import { loadConfig } from '../config/store.js'
import { startAll, ensureDirectories, ensureOverlay } from '../daemon/manager.js'
import { getProcessStatus } from '../daemon/pid.js'
import { log, fmt, printHeader, printKv } from '../utils/logger.js'

export async function upCommand(options: { force?: boolean }) {
  const status = getProcessStatus()

  if (status.backend.running && status.overlay.running) {
    log.warn('crawd.bot is already running')
    log.dim('Use `crawd restart` to restart, or `crawd down` to stop')
    return
  }

  ensureDirectories()

  if (options.force) {
    ensureOverlay(true)
  }

  try {
    await startAll()

    const config = loadConfig()

    // Wait a moment for processes to start
    await new Promise((r) => setTimeout(r, 1000))

    const newStatus = getProcessStatus()

    printHeader('crawd.bot is starting...')
    console.log()

    if (newStatus.backend.running) {
      log.success(`Backend running (PID ${newStatus.backend.pid})`)
    } else {
      log.error('Backend failed to start - check logs with `crawd logs`')
    }

    if (newStatus.overlay.running) {
      log.success(`Overlay running (PID ${newStatus.overlay.pid})`)
    } else {
      log.error('Overlay failed to start - check logs with `crawd logs`')
    }

    console.log()
    printHeader('URLs')
    printKv('Overlay', fmt.url(`http://localhost:${config.ports.overlay}`))
    printKv('Backend', fmt.url(`http://localhost:${config.ports.backend}`))
    printKv('OBS Source', fmt.url(`http://localhost:${config.ports.overlay}`))

    console.log()
    log.dim('View logs with: crawd logs')
    log.dim('Stop with: crawd down')
  } catch (err) {
    log.error(`Failed to start: ${err}`)
    process.exit(1)
  }
}
