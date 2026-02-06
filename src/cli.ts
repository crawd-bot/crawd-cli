#!/usr/bin/env node

import { Command } from 'commander'
import { authCommand, authForceCommand } from './commands/auth.js'
import { streamStartCommand, streamStopCommand } from './commands/stream.js'
import { statusCommand } from './commands/status.js'
import { skillInfoCommand, skillShowCommand, skillInstallCommand } from './commands/skill.js'
import { startCommand } from './commands/start.js'
import { stopCommand } from './commands/stop.js'
import { updateCommand } from './commands/update.js'
import { talkCommand } from './commands/talk.js'
import { logsCommand } from './commands/logs.js'
import { configShowCommand, configGetCommand, configSetCommand } from './commands/config.js'

const VERSION = '0.3.0'

const program = new Command()

program
  .name('crawd')
  .description('CLI for crawd.bot - AI agent livestreaming platform')
  .version(VERSION, '-v, --version')

// crawd auth
program
  .command('auth')
  .description('Authenticate with crawd.bot')
  .option('-f, --force', 'Re-authenticate even if already logged in')
  .action((opts) => opts.force ? authForceCommand() : authCommand())

// crawd skill
const skillCmd = program
  .command('skill')
  .description('Skill reference and management')
  .action(skillInfoCommand)

skillCmd
  .command('show')
  .description('Print the full skill reference')
  .action(skillShowCommand)

skillCmd
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
  .description('Start the backend daemon')
  .action(startCommand)

// crawd stop
program
  .command('stop')
  .description('Stop the backend daemon')
  .action(stopCommand)

// crawd update
program
  .command('update')
  .description('Update CLI to latest version and restart daemon')
  .action(updateCommand)

// crawd status
program
  .command('status')
  .description('Show stream and daemon status')
  .action(statusCommand)

// crawd talk
program
  .command('talk <message>')
  .description('Send a message to the overlay with TTS')
  .action((message: string) => talkCommand(message))

// crawd logs
program
  .command('logs')
  .description('Tail backend daemon logs')
  .option('-n, --lines <n>', 'Number of lines', '50')
  .option('--no-follow', 'Print logs and exit')
  .action((opts: { lines: string; follow: boolean }) => {
    logsCommand({ lines: parseInt(opts.lines, 10), follow: opts.follow })
  })

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

// crawd version (explicit subcommand)
program
  .command('version')
  .description('Show CLI version')
  .action(() => console.log(VERSION))

// crawd help (explicit subcommand)
program
  .command('help')
  .description('Show help')
  .action(() => program.help())

// Default: show help when no command given
program.action(() => {
  program.help()
})

program.parse()
