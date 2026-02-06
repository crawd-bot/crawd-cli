import type { ChatMessage } from './types'
import type { BaseChatClient } from './base'

/**
 * Orchestrates multiple chat clients with reconnection policy.
 * Uses string keys to allow multiple clients per platform.
 */
export class ChatManager {
  private clients = new Map<string, BaseChatClient>()
  private messageHandlers: ((msg: ChatMessage) => void)[] = []
  private reconnectTimers = new Map<string, NodeJS.Timeout>()

  /**
   * Register a client with a unique key.
   * Key can be platform name or custom (e.g., 'youtube:stream1')
   */
  registerClient(key: string, client: BaseChatClient): void {
    this.clients.set(key, client)

    client.on('message', (msg: ChatMessage) => {
      this.messageHandlers.forEach(handler => handler(msg))
    })

    client.on('connected', () => {
      console.log(`[ChatManager] ${key} connected`)
      this.clearReconnectTimer(key)
    })

    client.on('disconnected', () => {
      console.log(`[ChatManager] ${key} disconnected`)
      this.scheduleReconnect(key)
    })

    client.on('error', (error: Error) => {
      console.error(`[ChatManager] ${key} error:`, error.message)
    })
  }

  private scheduleReconnect(key: string, attempt = 1): void {
    const maxAttempts = 5
    if (attempt > maxAttempts) {
      console.error(`[ChatManager] ${key} failed after ${maxAttempts} attempts, giving up`)
      return
    }

    const delay = Math.min(5000 * Math.pow(2, attempt - 1), 60000)
    console.log(`[ChatManager] ${key} reconnecting in ${delay}ms (attempt ${attempt})`)

    const timer = setTimeout(async () => {
      const client = this.clients.get(key)
      if (!client || client.isConnected()) return

      try {
        await client.connect()
      } catch {
        this.scheduleReconnect(key, attempt + 1)
      }
    }, delay)

    this.reconnectTimers.set(key, timer)
  }

  private clearReconnectTimer(key: string): void {
    const timer = this.reconnectTimers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.reconnectTimers.delete(key)
    }
  }

  async connectAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.clients.entries()).map(async ([key, client]) => {
        try {
          await client.connect()
        } catch (err) {
          console.error(`[ChatManager] ${key} initial connect failed:`, err)
          this.scheduleReconnect(key)
        }
      })
    )
  }

  disconnectAll(): void {
    this.reconnectTimers.forEach(timer => clearTimeout(timer))
    this.reconnectTimers.clear()
    this.clients.forEach(client => {
      if (client.isConnected()) client.disconnect()
    })
  }

  onMessage(handler: (msg: ChatMessage) => void): void {
    this.messageHandlers.push(handler)
  }

  getConnectedKeys(): string[] {
    return Array.from(this.clients.entries())
      .filter(([_, client]) => client.isConnected())
      .map(([key]) => key)
  }

  getClient(key: string): BaseChatClient | undefined {
    return this.clients.get(key)
  }
}
