/**
 * Crawd overlay client SDK.
 *
 * Connects to the crawd backend daemon over WebSocket and provides
 * typed event callbacks for building custom overlays.
 *
 * ```ts
 * import { createCrawdClient } from '@crawd/cli'
 *
 * const client = createCrawdClient('http://localhost:4000')
 *
 * client.on('reply-turn', (turn) => { ... })
 * client.on('talk', (msg) => { ... })
 * client.on('tts', (data) => { ... })
 * client.on('status', (data) => { ... })
 * client.on('connect', () => { ... })
 * client.on('disconnect', () => { ... })
 *
 * // Cleanup
 * client.destroy()
 * ```
 */

import { io, type Socket } from 'socket.io-client'
import type {
  ReplyTurnEvent,
  TalkEvent,
  TalkDoneEvent,
  StatusEvent,
  McapEvent,
} from './types'

export type CrawdClientEvents = {
  'reply-turn': (data: ReplyTurnEvent) => void
  'talk': (data: TalkEvent) => void
  'status': (data: StatusEvent) => void
  'mcap': (data: McapEvent) => void
  'connect': () => void
  'disconnect': () => void
}

export type CrawdEmitEvents = {
  'talk:done': TalkDoneEvent
}

export type CrawdClient = {
  /** Listen for a backend event */
  on: <K extends keyof CrawdClientEvents>(event: K, handler: CrawdClientEvents[K]) => void
  /** Remove an event listener */
  off: <K extends keyof CrawdClientEvents>(event: K, handler: CrawdClientEvents[K]) => void
  /** Send an event to the backend */
  emit: <K extends keyof CrawdEmitEvents>(event: K, data: CrawdEmitEvents[K]) => void
  /** Disconnect and clean up */
  destroy: () => void
  /** Underlying socket.io instance (escape hatch) */
  socket: Socket
}

export function createCrawdClient(url: string): CrawdClient {
  const socket = io(url, { transports: ['websocket'] })

  const eventMap: Record<string, string> = {
    'reply-turn': 'crawd:reply-turn',
    'talk': 'crawd:talk',
    'talk:done': 'crawd:talk:done',
    'status': 'crawd:status',
    'mcap': 'crawd:mcap',
  }

  function on<K extends keyof CrawdClientEvents>(event: K, handler: CrawdClientEvents[K]) {
    const socketEvent = eventMap[event as string]
    if (socketEvent) {
      socket.on(socketEvent, handler as (...args: unknown[]) => void)
    } else {
      socket.on(event as string, handler as (...args: unknown[]) => void)
    }
  }

  function off<K extends keyof CrawdClientEvents>(event: K, handler: CrawdClientEvents[K]) {
    const socketEvent = eventMap[event as string]
    if (socketEvent) {
      socket.off(socketEvent, handler as (...args: unknown[]) => void)
    } else {
      socket.off(event as string, handler as (...args: unknown[]) => void)
    }
  }

  function emit<K extends keyof CrawdEmitEvents>(event: K, data: CrawdEmitEvents[K]) {
    const socketEvent = eventMap[event as string] ?? event
    socket.emit(socketEvent, data)
  }

  function destroy() {
    socket.disconnect()
  }

  return { on, off, emit, destroy, socket }
}
