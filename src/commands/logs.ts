import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { LOG_FILES } from '../utils/paths.js'
import { log, fmt } from '../utils/logger.js'

export type LogTarget = 'backend' | 'overlay' | 'crawdbot' | 'all'

export function logsCommand(target: LogTarget = 'all', options: { follow?: boolean; lines?: number }) {
  const lines = options.lines ?? 50
  const follow = options.follow ?? true

  const files: string[] = []

  if (target === 'all' || target === 'backend') {
    if (existsSync(LOG_FILES.backend)) {
      files.push(LOG_FILES.backend)
    } else {
      log.dim('No backend logs found')
    }
  }

  if (target === 'all' || target === 'overlay') {
    if (existsSync(LOG_FILES.overlay)) {
      files.push(LOG_FILES.overlay)
    } else {
      log.dim('No overlay logs found')
    }
  }

  if (target === 'all' || target === 'crawdbot') {
    if (existsSync(LOG_FILES.crawdbot)) {
      files.push(LOG_FILES.crawdbot)
    } else if (target === 'crawdbot') {
      log.dim('No crawdbot logs found')
    }
  }

  if (files.length === 0) {
    log.warn('No log files found. Is crawd.bot running?')
    log.dim('Start with: crawd up')
    return
  }

  log.info(`Tailing logs from: ${files.map((f) => fmt.path(f)).join(', ')}`)
  console.log()

  const args = follow ? ['-f', '-n', String(lines), ...files] : ['-n', String(lines), ...files]

  const tail = spawn('tail', args, {
    stdio: 'inherit',
  })

  tail.on('error', (err) => {
    log.error(`Failed to tail logs: ${err.message}`)
  })

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    tail.kill()
    process.exit(0)
  })
}
