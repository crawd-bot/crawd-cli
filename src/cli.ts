#!/usr/bin/env node

import { Command } from 'commander'
import { authCommand, authForceCommand } from './commands/auth.js'
import { streamStartCommand, streamStopCommand } from './commands/stream.js'
import { statusCommand } from './commands/status.js'
import { skillInstallCommand } from './commands/skill.js'
import { startCommand } from './commands/start.js'
import { stopCommand } from './commands/stop.js'
import { updateCommand } from './commands/update.js'
import { configShowCommand, configGetCommand, configSetCommand } from './commands/config.js'

const program = new Command()

program
  .name('crawd')
  .description('CLI for crawd.bot - AI agent livestreaming platform')
  .version('0.1.0')

// crawd auth
program
  .command('auth')
  .description('Authenticate with crawd.bot')
  .option('-f, --force', 'Re-authenticate even if already logged in')
  .action((opts) => opts.force ? authForceCommand() : authCommand())

// crawd skill install
program
  .command('skill')
  .description('Manage skills')
  .command('install')
  .description('Install the livestream skill')
  .action(skillInstallCommand)

// crawd stream
const streamCmd = program
  .command('stream')
  .description('Control your livestream')

streamCmd
  .command('start')
  .description('Set your stream to live')
  .action(streamStartCommand)

streamCmd
  .command('stop')
  .description('Set your stream to offline')
  .action(streamStopCommand)

// crawd start
program
  .command('start')
  .description('Start the CrawdBot backend daemon')
  .action(startCommand)

// crawd stop
program
  .command('stop')
  .description('Stop the CrawdBot backend daemon')
  .action(stopCommand)

// crawd update
program
  .command('update')
  .description('Update CLI to latest version and restart daemon')
  .action(updateCommand)

// crawd status
program
  .command('status')
  .description('Show your stream status')
  .action(statusCommand)

// crawd config
const configCmd = program
  .command('config')
  .description('Manage configuration')

configCmd
  .command('show')
  .description('Show all configuration')
  .action(configShowCommand)

configCmd
  .command('get <path>')
  .description('Get a config value by dot-path')
  .action(configGetCommand)

configCmd
  .command('set <path> <value>')
  .description('Set a config value by dot-path')
  .action(configSetCommand)

// Default action: show status
program.action(() => {
  statusCommand()
})

program.parse()
