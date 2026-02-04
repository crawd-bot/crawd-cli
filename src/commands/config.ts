import { loadConfig, getConfigValue, setConfigValue } from '../config/store.js'
import { log, fmt } from '../utils/logger.js'

export function configShowCommand() {
  const config = loadConfig()
  console.log(JSON.stringify(config, null, 2))
}

export function configGetCommand(path: string) {
  const value = getConfigValue(path)
  if (value === undefined) {
    log.error(`Config key not found: ${path}`)
    process.exit(1)
  }

  if (typeof value === 'object') {
    console.log(JSON.stringify(value, null, 2))
  } else {
    console.log(value)
  }
}

export function configSetCommand(path: string, value: string) {
  // Try to parse as JSON, otherwise use as string
  let parsed: unknown = value
  try {
    parsed = JSON.parse(value)
  } catch {
    // Keep as string
  }

  // Handle special boolean cases
  if (value === 'true') parsed = true
  if (value === 'false') parsed = false

  try {
    setConfigValue(path, parsed)
    log.success(`Set ${fmt.bold(path)} = ${JSON.stringify(parsed)}`)
  } catch (err) {
    log.error(`Invalid config: ${err}`)
    process.exit(1)
  }
}
