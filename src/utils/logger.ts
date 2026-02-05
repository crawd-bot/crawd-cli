import chalk from 'chalk'

export const log = {
  info: (msg: string) => console.log(chalk.blue('ℹ'), msg),
  success: (msg: string) => console.log(chalk.green('✓'), msg),
  warn: (msg: string) => console.log(chalk.yellow('⚠'), msg),
  error: (msg: string) => console.log(chalk.red('✗'), msg),
  dim: (msg: string) => console.log(chalk.dim(msg)),
}

export const fmt = {
  url: (url: string) => chalk.cyan.underline(url),
  path: (path: string) => chalk.yellow(path),
  cmd: (cmd: string) => chalk.green(cmd),
  bold: (s: string) => chalk.bold(s),
  dim: (s: string) => chalk.dim(s),
  success: (s: string) => chalk.green(s),
}

/** Print a labeled key-value pair */
export function printKv(label: string, value: string, indent = 2) {
  const padding = ' '.repeat(indent)
  console.log(`${padding}${chalk.dim(label + ':')} ${value}`)
}

/** Print a section header */
export function printHeader(title: string) {
  console.log()
  console.log(chalk.bold(title))
}

/** Print a status line with icon */
export function printStatus(
  label: string,
  ok: boolean,
  detail?: string,
  indent = 2
) {
  const padding = ' '.repeat(indent)
  const icon = ok ? chalk.green('✓') : chalk.red('✗')
  const status = detail ? ` ${chalk.dim(`(${detail})`)}` : ''
  console.log(`${padding}${icon} ${label}${status}`)
}
