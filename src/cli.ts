#!/usr/bin/env node

import { Command } from 'commander'
import { upCommand } from './commands/up.js'
import { downCommand } from './commands/down.js'
import { statusCommand } from './commands/status.js'
import { logsCommand, type LogTarget } from './commands/logs.js'
import { configShowCommand, configGetCommand, configSetCommand } from './commands/config.js'
import { authCommand } from './commands/auth.js'
import { ensureOverlay } from './daemon/manager.js'
import { log } from './utils/logger.js'
import { OVERLAY_DIR } from './utils/paths.js'

const program = new Command()

program
  .name('crawd')
  .description('CLI for CRAWD - AI agent livestreaming platform')
  .version('0.1.0')

// crawd up
program
  .command('up')
  .description('Start the CRAWD daemon (backend + overlay)')
  .option('-f, --force', 'Force reinstall overlay from template')
  .action(upCommand)

// crawd down
program
  .command('down')
  .description('Stop the CRAWD daemon')
  .action(downCommand)

// crawd restart
program
  .command('restart')
  .description('Restart the CRAWD daemon')
  .action(async () => {
    downCommand()
    await new Promise((r) => setTimeout(r, 1000))
    await upCommand({})
  })

// crawd status
program
  .command('status')
  .description('Show CRAWD status and URLs')
  .action(statusCommand)

// crawd logs
program
  .command('logs [target]')
  .description('Tail daemon logs (backend, overlay, or all)')
  .option('-n, --lines <n>', 'Number of lines to show', '50')
  .option('--no-follow', 'Do not follow (just print and exit)')
  .action((target: LogTarget | undefined, options) => {
    logsCommand(target ?? 'all', {
      follow: options.follow !== false,
      lines: parseInt(options.lines, 10),
    })
  })

// crawd auth
program
  .command('auth')
  .description('Authenticate with crawd.bot')
  .action(authCommand)

// crawd config
const configCmd = program
  .command('config')
  .description('View or modify configuration')

configCmd
  .command('show')
  .description('Show all configuration')
  .action(configShowCommand)

configCmd
  .command('get <path>')
  .description('Get a config value (e.g., gateway.url)')
  .action(configGetCommand)

configCmd
  .command('set <path> <value>')
  .description('Set a config value (e.g., gateway.url ws://localhost:18789)')
  .action(configSetCommand)

// crawd overlay
const overlayCmd = program
  .command('overlay')
  .description('Manage the overlay frontend')

overlayCmd
  .command('reset')
  .description('Reset overlay to default template')
  .action(() => {
    log.info('Resetting overlay...')
    ensureOverlay(true)
    log.success('Overlay reset to defaults')
    log.dim(`Location: ${OVERLAY_DIR}`)
  })

overlayCmd
  .command('path')
  .description('Print the overlay directory path')
  .action(() => {
    console.log(OVERLAY_DIR)
  })

// Default action: show status
program.action(() => {
  statusCommand()
})

program.parse()
