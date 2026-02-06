import { PumpfunSocketClient } from '../../pumpfun/v2/socket/client'
import type { PumpfunMessage } from '../../pumpfun/v2/socket/types'
import { BaseChatClient } from '../base'
import { generateShortId } from '../types'
import type { ChatPlatform, ChatMessage } from '../types'

/**
 * Adapter wrapping existing PumpfunSocketClient to unified interface.
 */
export class PumpFunChatClient extends BaseChatClient {
  readonly platform: ChatPlatform = 'pumpfun'

  private client: PumpfunSocketClient
  private roomId: string
  private _connected = false

  constructor(roomId: string, authToken: string | null) {
    super()
    this.roomId = roomId
    this.client = new PumpfunSocketClient(authToken)
  }

  async connect(): Promise<void> {
    this.client.connect()
    await this.client.joinRoom(this.roomId)

    this.client.onMessage((msg: PumpfunMessage) => {
      const chatMsg: ChatMessage = {
        id: `pf:${msg.id}`,
        shortId: generateShortId(),
        platform: 'pumpfun',
        username: msg.username,
        message: msg.message,
        timestamp: Date.now(),
        metadata: {
          userAddress: msg.userAddress,
          roomId: msg.roomId
        }
      }
      this.emit('message', chatMsg)
    })

    this._connected = true
    this.emit('connected')
  }

  disconnect(): void {
    this.client.disconnect()
    this._connected = false
    this.emit('disconnected')
  }

  isConnected(): boolean {
    return this._connected
  }
}
