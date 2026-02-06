import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { LOG_FILES } from '../utils/paths.js'
import { log, fmt } from '../utils/logger.js'

export function logsCommand(options: { follow?: boolean; lines?: number }) {
  const lines = options.lines ?? 50
  const follow = options.follow ?? true
  const file = LOG_FILES.backend

  if (!existsSync(file)) {
    log.warn('No logs found. Is the daemon running?')
    log.dim('Start with: crawd start')
    return
  }

  log.info(`Tailing ${fmt.path(file)}`)
  console.log()

  const args = follow ? ['-f', '-n', String(lines), file] : ['-n', String(lines), file]

  const tail = spawn('tail', args, { stdio: 'inherit' })

  tail.on('error', (err) => {
    log.error(`Failed to tail logs: ${err.message}`)
  })

  process.on('SIGINT', () => {
    tail.kill()
    process.exit(0)
  })
}
