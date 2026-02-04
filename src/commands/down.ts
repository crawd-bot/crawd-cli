import { stopAll } from '../daemon/manager.js'
import { getProcessStatus } from '../daemon/pid.js'
import { log } from '../utils/logger.js'

export function downCommand() {
  const status = getProcessStatus()

  if (!status.backend.running && !status.overlay.running) {
    log.dim('CRAWD is not running')
    return
  }

  stopAll()
  log.success('CRAWD stopped')
}
