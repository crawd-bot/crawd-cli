import { createServer } from 'http'
import open from 'open'
import { saveConfig, loadConfig } from '../config/store.js'
import { log, fmt, printKv, printHeader } from '../utils/logger.js'
import { CONFIG_PATH } from '../utils/paths.js'

const PLATFORM_URL = 'https://platform.crawd.bot'
const CALLBACK_PORT = 9876

async function fetchMe(apiKey: string): Promise<{ email: string; displayName: string | null } | null> {
  try {
    const response = await fetch(`${PLATFORM_URL}/api/me`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })
    if (!response.ok) return null
    return (await response.json()) as { email: string; displayName: string | null }
  } catch {
    return null
  }
}

export async function authCommand() {
  const config = loadConfig()

  // If already authenticated, show current auth info
  if (config.apiKey) {
    const me = await fetchMe(config.apiKey)

    if (me) {
      printHeader('Authenticated')
      console.log()
      printKv('Account', me.email)
      if (me.displayName) printKv('Name', me.displayName)
      printKv('Credentials', fmt.path(CONFIG_PATH))
      console.log()
      log.dim('To re-authenticate, run: crawd auth --force')
      console.log()
      return
    }

    // Key exists but is invalid/expired
    log.warn('Existing credential is invalid or expired')
    console.log()
  }

  startAuthFlow()
}

export async function authForceCommand() {
  startAuthFlow()
}

function startAuthFlow() {
  log.info('Starting authentication...')

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`)

    if (url.pathname === '/callback') {
      const token = url.searchParams.get('token')

      if (token) {
        const config = loadConfig()
        config.apiKey = token
        saveConfig(config)

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <title>crawd.bot - Authenticated</title>
              <style>
                body {
                  font-family: system-ui, -apple-system, sans-serif;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  height: 100vh;
                  margin: 0;
                  background: #000;
                  color: #fff;
                }
                .container {
                  text-align: center;
                  padding: 2rem;
                }
                h1 { color: #FBA875; }
                p { color: #888; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>✓ Authenticated!</h1>
                <p>You can close this window and return to the terminal.</p>
              </div>
            </body>
          </html>
        `)

        log.success('Authentication successful!')
        log.dim(`API key saved to ${CONFIG_PATH}`)

        setTimeout(() => {
          server.close()
          process.exit(0)
        }, 1000)
      } else {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Missing token')
        log.error('Authentication failed - no token received')
      }
    } else {
      res.writeHead(404)
      res.end('Not found')
    }
  })

  server.listen(CALLBACK_PORT, () => {
    const callbackUrl = `http://localhost:${CALLBACK_PORT}/callback`
    const authUrl = `${PLATFORM_URL}/auth/cli?callback=${encodeURIComponent(callbackUrl)}`

    log.info('Opening browser for authentication...')
    console.log()
    log.dim('If browser does not open, visit:')
    console.log(`  ${fmt.url(authUrl)}`)
    console.log()

    open(authUrl).catch(() => {
      log.warn('Could not open browser automatically')
    })
  })

  server.on('error', (err) => {
    log.error(`Failed to start callback server: ${err.message}`)
    log.dim('Make sure port 9876 is available')
    process.exit(1)
  })

  // Timeout after 5 minutes
  setTimeout(() => {
    log.error('Authentication timed out')
    server.close()
    process.exit(1)
  }, 5 * 60 * 1000)
}
