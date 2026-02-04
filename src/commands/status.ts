import { loadConfig } from '../config/store.js'
import { getProcessStatus } from '../daemon/pid.js'
import { fmt, printHeader, printKv, printStatus } from '../utils/logger.js'

export function statusCommand() {
  const status = getProcessStatus()
  const config = loadConfig()

  const anyRunning = status.backend.running || status.overlay.running

  printHeader('CRAWD Status')
  console.log()

  printStatus(
    'Backend',
    status.backend.running,
    status.backend.pid ? `PID ${status.backend.pid}` : undefined
  )
  printStatus(
    'Overlay',
    status.overlay.running,
    status.overlay.pid ? `PID ${status.overlay.pid}` : undefined
  )

  if (anyRunning) {
    console.log()
    printHeader('URLs')
    printKv('Overlay', fmt.url(`http://localhost:${config.ports.overlay}`))
    printKv('Backend', fmt.url(`http://localhost:${config.ports.backend}`))
    printKv('OBS Source', fmt.url(`http://localhost:${config.ports.overlay}`))
  }

  console.log()

  if (!anyRunning) {
    console.log('  Start with: crawd up')
  } else {
    console.log('  Stop with: crawd down')
    console.log('  View logs: crawd logs')
  }

  console.log()
}
