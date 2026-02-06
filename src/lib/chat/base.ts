import { EventEmitter } from 'events'
import type { ChatPlatform } from './types'

/**
 * Abstract base class for chat clients.
 * Uses EventEmitter - listen with: client.on('message', (msg) => ...)
 */
export abstract class BaseChatClient extends EventEmitter {
  abstract readonly platform: ChatPlatform
  abstract connect(): Promise<void>
  abstract disconnect(): void
  abstract isConnected(): boolean
}
