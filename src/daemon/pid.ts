import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { PID_FILES, PIDS_DIR } from '../utils/paths.js'

export type ProcessName = 'backend' | 'overlay'

/** Write a PID file */
export function writePid(name: ProcessName, pid: number) {
  if (!existsSync(PIDS_DIR)) {
    mkdirSync(PIDS_DIR, { recursive: true })
  }
  writeFileSync(PID_FILES[name], String(pid))
}

/** Read a PID from file */
export function readPid(name: ProcessName): number | null {
  const path = PID_FILES[name]
  if (!existsSync(path)) {
    return null
  }
  try {
    const content = readFileSync(path, 'utf-8').trim()
    const pid = parseInt(content, 10)
    return isNaN(pid) ? null : pid
  } catch {
    return null
  }
}

/** Remove a PID file */
export function removePid(name: ProcessName) {
  const path = PID_FILES[name]
  if (existsSync(path)) {
    unlinkSync(path)
  }
}

/** Check if a process is running by PID */
export function isProcessRunning(pid: number): boolean {
  try {
    // kill with signal 0 doesn't kill the process, just checks if it exists
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Check if a named process is running */
export function isRunning(name: ProcessName): boolean {
  const pid = readPid(name)
  if (pid === null) return false
  return isProcessRunning(pid)
}

/** Kill a process by name if running */
export function killProcess(name: ProcessName): boolean {
  const pid = readPid(name)
  if (pid === null) return false

  if (!isProcessRunning(pid)) {
    removePid(name)
    return false
  }

  try {
    process.kill(pid, 'SIGTERM')
    // Give it a moment to terminate gracefully
    setTimeout(() => {
      if (isProcessRunning(pid)) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // Process may have already exited
        }
      }
    }, 2000)
    removePid(name)
    return true
  } catch {
    removePid(name)
    return false
  }
}

/** Get status of all processes */
export function getProcessStatus(): Record<ProcessName, { running: boolean; pid: number | null }> {
  return {
    backend: {
      running: isRunning('backend'),
      pid: readPid('backend'),
    },
    overlay: {
      running: isRunning('overlay'),
      pid: readPid('overlay'),
    },
  }
}
