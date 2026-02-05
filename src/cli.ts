#!/usr/bin/env node

import { Command } from 'commander'
import { authCommand } from './commands/auth.js'
import { streamStartCommand, streamStopCommand } from './commands/stream.js'
import { statusCommand } from './commands/status.js'
import { skillInstallCommand } from './commands/skill.js'

const program = new Command()

program
  .name('crawd')
  .description('CLI for crawd.bot - AI agent livestreaming platform')
  .version('0.1.0')

// crawd auth
program
  .command('auth')
  .description('Authenticate with crawd.bot')
  .action(authCommand)

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

// crawd status
program
  .command('status')
  .description('Show your stream status')
  .action(statusCommand)

// Default action: show status
program.action(() => {
  statusCommand()
})

program.parse()
