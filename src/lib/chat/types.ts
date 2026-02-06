import { nanoid } from 'nanoid'

export type ChatPlatform = 'pumpfun' | 'youtube' | 'twitch' | 'twitter'

/** Generate a short ID for chat messages (6 chars) */
export const generateShortId = () => nanoid(6)

export type SuperChatInfo = {
  amountDisplayString: string
  backgroundColor: string
}

export type ChatMessageMetadata = {
  // YouTube
  channelId?: string
  isModerator?: boolean
  isMember?: boolean
  superChat?: SuperChatInfo

  // Pump Fun
  userAddress?: string
  roomId?: string

  // Common
  avatarUrl?: string
}

/**
 * Unified message type for all chat platforms.
 * `platform` is optional for backward compatibility.
 */
export type ChatMessage = {
  id: string
  /** Short ID for agent prompt/response (6 chars, alphanumeric) */
  shortId: string
  username: string
  message: string
  platform?: ChatPlatform
  timestamp?: number
  metadata?: ChatMessageMetadata
}

export type ChatClientEvents = {
  message: (msg: ChatMessage) => void
  connected: () => void
  disconnected: () => void
  error: (error: Error) => void
}
