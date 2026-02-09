/**
 * Shared types for the CrawdBot backend ↔ frontend (overlay) API.
 *
 * Install `@crawd/cli` and import:
 *   import type { CrawdEvents, ReplyTurnEvent } from '@crawd/cli'
 */

// Re-export chat types used in events
export type {
  ChatMessage,
  ChatPlatform,
  ChatMessageMetadata,
  SuperChatInfo,
} from './lib/chat/types'

/** TTS provider identifier */
export type TtsProvider = 'openai' | 'elevenlabs' | 'tiktok'

// --- Socket.IO event payloads ---

/** Turn-based reply: chat message + bot response, each with TTS audio */
export type ReplyTurnEvent = {
  /** Correlation ID — overlay sends talk:done with this ID when both audios finish */
  id: string
  chat: { username: string; message: string }
  botMessage: string
  chatTtsUrl: string
  botTtsUrl: string
  /** TTS provider used for the chat audio */
  chatTtsProvider?: TtsProvider
  /** TTS provider used for the bot audio */
  botTtsProvider?: TtsProvider
}

/** Bot speech bubble with pre-generated TTS (atomic event) */
export type TalkEvent = {
  /** Correlation ID — overlay sends talk:done with this ID when audio finishes */
  id: string
  /** Bot reply text */
  message: string
  /** Bot TTS audio URL */
  ttsUrl: string
  /** TTS provider used for the bot audio */
  ttsProvider?: TtsProvider
  /** Optional: chat message being replied to (overlay plays this first) */
  chat?: {
    message: string
    username: string
    ttsUrl: string
  }
}

/** Overlay → backend acknowledgement that a talk finished playing */
export type TalkDoneEvent = {
  id: string
}

/** Overlay → backend mock chat message (for testing) */
export type MockChatEvent = {
  username: string
  message: string
}

/** Incoming chat message from a platform */
export type { ChatMessage as ChatEvent } from './lib/chat/types'

/** Market cap update */
export type McapEvent = {
  mcap: number
}

/** Coordinator status change */
export type StatusEvent = {
  status: string
}

/** Map of all socket event names to their payload types */
export type CrawdEvents = {
  'crawd:reply-turn': ReplyTurnEvent
  'crawd:talk': TalkEvent
  'crawd:talk:done': TalkDoneEvent
  'crawd:chat': import('./lib/chat/types').ChatMessage
  'crawd:mock-chat': MockChatEvent
  'crawd:mcap': McapEvent
  'crawd:status': StatusEvent
}
