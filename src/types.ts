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

// --- Socket.IO event payloads ---

/** Turn-based reply: chat message + bot response (text only, TTS handled by overlay) */
export type ReplyTurnEvent = {
  /** Correlation ID — overlay sends talk:done with this ID when finished */
  id: string
  chat: { username: string; message: string }
  botMessage: string
}

/** Bot speech bubble (text only, TTS handled by overlay) */
export type TalkEvent = {
  /** Correlation ID — overlay sends talk:done with this ID when finished */
  id: string
  /** Bot reply text */
  message: string
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
