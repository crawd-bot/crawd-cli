import { createServer } from 'http'
import open from 'open'
import { saveEnv, loadEnv, updateConfig } from '../config/store.js'
import { log, fmt } from '../utils/logger.js'

const CRAWD_AUTH_URL = 'https://crawd.bot/auth/cli'
const CALLBACK_PORT = 9876

export async function authCommand() {
  log.info('Starting authentication flow...')

  // Create a temporary server to receive the OAuth callback
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`)

    if (url.pathname === '/callback') {
      const token = url.searchParams.get('token')
      const gatewayToken = url.searchParams.get('gateway_token')
      const gatewayUrl = url.searchParams.get('gateway_url')

      if (token) {
        // Save credentials
        const env = loadEnv()
        env.CRAWD_API_KEY = token
        if (gatewayToken) {
          env.CRAWD_GATEWAY_TOKEN = gatewayToken
        }
        saveEnv(env)

        // Update config
        updateConfig({
          apiKey: token,
          gateway: {
            token: gatewayToken ?? undefined,
            url: gatewayUrl ?? 'ws://localhost:18789',
            channelId: 'live',
          },
        })

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>CRAWD - Authenticated</title>
              <style>
                body {
                  font-family: system-ui, -apple-system, sans-serif;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  height: 100vh;
                  margin: 0;
                  background: #1a1a2e;
                  color: #eee;
                }
                .container {
                  text-align: center;
                  padding: 2rem;
                }
                h1 { color: #00d4ff; }
                p { color: #aaa; }
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
        log.dim('Credentials saved to ~/.crawd/.env')

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
    const authUrl = `${CRAWD_AUTH_URL}?callback=http://localhost:${CALLBACK_PORT}/callback`

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
