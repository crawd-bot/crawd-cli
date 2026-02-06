import { isRunning, killProcess } from '../daemon/pid.js'
import { log } from '../utils/logger.js'

export function stopCommand() {
  if (!isRunning('crawdbot')) {
    log.dim('CrawdBot backend is not running')
    return
  }

  const killed = killProcess('crawdbot')
  if (killed) {
    log.success('CrawdBot backend stopped')
  } else {
    log.error('Failed to stop CrawdBot backend')
  }
}
