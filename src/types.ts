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
  chat: { username: string; message: string }
  botMessage: string
  chatTtsUrl: string
  botTtsUrl: string
}

/** Bot speech bubble (vibe or standalone message) */
export type TalkEvent = {
  message: string
  replyTo: string | null
}

/** TTS audio ready for the current talk message */
export type TtsEvent = {
  ttsUrl: string
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
  'crawd:tts': TtsEvent
  'crawd:chat': import('./lib/chat/types').ChatMessage
  'crawd:mcap': McapEvent
  'crawd:status': StatusEvent
}
