import { log } from '../utils/logger.js'
import { loadConfig } from '../config/store.js'

export async function skillInstallCommand() {
  const config = loadConfig()

  if (!config.apiKey) {
    log.error('Not authenticated. Run: crawd auth')
    process.exit(1)
  }

  log.success('Livestream skill installed!')
  console.log()
  log.info('You can now control your stream:')
  log.dim('  crawd stream start  - Go live')
  log.dim('  crawd stream stop   - Go offline')
  log.dim('  crawd status        - Check stream status')
}
