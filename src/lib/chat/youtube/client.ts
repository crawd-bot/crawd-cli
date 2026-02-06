import { Masterchat, stringify } from '@stu43005/masterchat'
import { BaseChatClient } from '../base'
import { generateShortId } from '../types'
import type { ChatPlatform, ChatMessage } from '../types'

/**
 * YouTube Live Chat client using masterchat (no API credentials needed).
 */
export class YouTubeChatClient extends BaseChatClient {
  readonly platform: ChatPlatform = 'youtube'

  private mc: Masterchat | null = null
  private _connected = false
  private videoId: string

  // Deduplication: sliding window of recent IDs
  private recentIds: string[] = []
  private readonly maxRecentIds = 500

  constructor(videoIdOrUrl: string) {
    super()
    this.videoId = this.extractVideoId(videoIdOrUrl)
  }

  async connect(): Promise<void> {
    this.mc = await Masterchat.init(this.videoId)

    this.mc.on('chat', (chat) => {
      const prefixedId = `yt:${chat.id}`
      if (this.recentIds.includes(prefixedId)) return
      this.trackId(prefixedId)

      const msg: ChatMessage = {
        id: prefixedId,
        shortId: generateShortId(),
        platform: 'youtube',
        username: chat.authorName ?? 'Anonymous',
        message: chat.message ? stringify(chat.message) : '',
        timestamp: chat.timestamp?.getTime() ?? Date.now(),
        metadata: {
          channelId: chat.authorChannelId,
          isModerator: chat.isModerator,
          isMember: !!chat.membership,
          avatarUrl: chat.authorPhoto,
        }
      }

      this.emit('message', msg)
    })

    // Handle super chats via actions event
    this.mc.on('actions', (actions) => {
      for (const action of actions) {
        if (action.type !== 'addSuperChatItemAction') continue

        const prefixedId = `yt:${action.id}`
        if (this.recentIds.includes(prefixedId)) continue
        this.trackId(prefixedId)

        const msg: ChatMessage = {
          id: prefixedId,
          shortId: generateShortId(),
          platform: 'youtube',
          username: action.authorName ?? 'Anonymous',
          message: action.message ? stringify(action.message) : '',
          timestamp: action.timestamp?.getTime() ?? Date.now(),
          metadata: {
            channelId: action.authorChannelId,
            isModerator: action.isModerator,
            isMember: !!action.membership,
            avatarUrl: action.authorPhoto,
            superChat: {
              amountDisplayString: `${action.currency}${action.amount}`,
              backgroundColor: action.color ?? 'blue'
            }
          }
        }

        this.emit('message', msg)
      }
    })

    this.mc.on('error', (err) => {
      console.error('[YouTube] Chat error:', err)
      this.emit('error', err)
    })

    this.mc.on('end', () => {
      this._connected = false
      this.emit('disconnected')
    })

    this.mc.listen()
    this._connected = true
    this.emit('connected')
  }

  disconnect(): void {
    this.mc?.stop()
    this.mc = null
    this._connected = false
  }

  isConnected(): boolean {
    return this._connected
  }

  /** Update video ID for new stream without recreating client */
  setVideoId(videoIdOrUrl: string): void {
    this.videoId = this.extractVideoId(videoIdOrUrl)
  }

  private extractVideoId(input: string): string {
    const patterns = [
      /(?:v=|youtu\.be\/|\/live\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/
    ]
    for (const pattern of patterns) {
      const match = input.match(pattern)
      if (match) return match[1]
    }
    return input
  }

  private trackId(id: string): void {
    this.recentIds.push(id)
    if (this.recentIds.length > this.maxRecentIds) {
      this.recentIds.shift()
    }
  }
}
