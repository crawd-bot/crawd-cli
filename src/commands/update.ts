import { execSync } from 'child_process'
import { realpathSync } from 'fs'
import { isRunning, killProcess, readPid, isProcessRunning } from '../daemon/pid.js'
import { log } from '../utils/logger.js'
import { startCommand } from './start.js'

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

const INSTALL_CMD: Record<PackageManager, string> = {
  npm: 'npm install -g @crawd/cli@latest',
  pnpm: 'pnpm add -g @crawd/cli@latest',
  yarn: 'yarn global add @crawd/cli@latest',
  bun: 'bun install -g @crawd/cli@latest',
}

/** Detect which package manager installed the CLI by resolving the binary path */
function detectPackageManager(): PackageManager {
  try {
    const bin = execSync('which crawd', { encoding: 'utf-8' }).trim()
    const resolved = realpathSync(bin)

    if (resolved.includes('/pnpm')) return 'pnpm'
    if (resolved.includes('/.bun/')) return 'bun'
    if (resolved.includes('/.yarn/') || resolved.includes('/yarn/')) return 'yarn'
  } catch {
    // which failed or path unresolvable — fall through
  }
  return 'npm'
}

/** Wait for a process to exit (up to timeoutMs) */
function waitForExit(pid: number, timeoutMs = 5000): boolean {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (!isProcessRunning(pid)) return true
    execSync('sleep 0.1')
  }
  return false
}

export async function updateCommand() {
  const daemonWasRunning = isRunning('crawdbot')
  const oldPid = readPid('crawdbot')

  // 1. Stop daemon if running
  if (daemonWasRunning && oldPid) {
    log.info('Stopping backend daemon...')
    killProcess('crawdbot')

    if (!waitForExit(oldPid)) {
      log.error('Backend daemon did not stop in time')
      process.exit(1)
    }
    log.success('Backend daemon stopped')
  }

  // 2. Detect package manager and update
  const pm = detectPackageManager()
  const cmd = INSTALL_CMD[pm]
  log.info(`Updating @crawd/cli via ${pm}...`)

  try {
    const output = execSync(`${cmd} 2>&1`, {
      encoding: 'utf-8',
      timeout: 60_000,
    })

    const versionMatch = output.match(/@crawd\/cli@([\d.]+)/)
    if (versionMatch) {
      log.success(`Updated to v${versionMatch[1]}`)
    } else {
      log.success('CLI updated')
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log.error(`Failed to update: ${msg}`)
    // Still restart daemon if it was running
    if (daemonWasRunning) {
      log.info('Restarting backend daemon with current version...')
      await startCommand()
    }
    process.exit(1)
  }

  // 3. Restart daemon if it was running
  if (daemonWasRunning) {
    log.info('Restarting backend daemon...')
    await startCommand()
  } else {
    log.dim('Backend daemon was not running, skipping restart')
  }
}
