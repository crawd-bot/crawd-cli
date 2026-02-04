import { useCallback, useEffect, useRef, useState } from "react"
import { io, type Socket } from "socket.io-client"
import { Chat, type ChatMessage } from "./components/Chat"
import { OverlayFace } from "./components/OverlayFace"
import { OverlayBubble } from "./components/OverlayBubble"
import { Notification } from "./components/Notification"

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000"
const BUBBLE_TIMEOUT = 15000
const BUBBLE_GAP = 1500
const NOTIFICATION_DELAY = 6000
const NOTIFICATION_GAP = 1000

type TalkItem = {
  text: string
  replyTo: string | null
  ttsUrl?: string
}

type NotifItem = {
  body: string
  ttsUrl: string | null
}

export function Overlay() {
  const [currentMessage, setCurrentMessage] = useState<{ text: string; replyTo: string | null } | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [currentNotif, setCurrentNotif] = useState<NotifItem | null>(null)
  const [connected, setConnected] = useState(false)

  const talkQueueRef = useRef<TalkItem[]>([])
  const talkProcessingRef = useRef(false)
  const talkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const talkAudioRef = useRef<HTMLAudioElement | null>(null)

  const notifQueueRef = useRef<NotifItem[]>([])
  const notifProcessingRef = useRef(false)
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Process next talk message from queue
  const processNextTalk = useCallback(() => {
    if (talkQueueRef.current.length === 0) {
      talkProcessingRef.current = false
      return
    }

    talkProcessingRef.current = true
    const item = talkQueueRef.current.shift()!
    setCurrentMessage({ text: item.text, replyTo: item.replyTo })

    const finish = () => {
      setCurrentMessage(null)
      talkTimerRef.current = setTimeout(() => processNextTalk(), BUBBLE_GAP)
    }

    if (item.ttsUrl) {
      if (talkAudioRef.current) talkAudioRef.current.pause()
      const audio = new Audio(item.ttsUrl)
      audio.volume = 0.8
      talkAudioRef.current = audio
      audio.onended = () => {
        talkTimerRef.current = setTimeout(finish, 1500)
      }
      audio.onerror = () => {
        talkTimerRef.current = setTimeout(finish, 3000)
      }
      audio.play().catch(() => {
        talkTimerRef.current = setTimeout(finish, 3000)
      })
      // Fallback if audio takes too long
      talkTimerRef.current = setTimeout(finish, 30000)
    } else {
      // No TTS yet — wait for it or timeout
      talkTimerRef.current = setTimeout(finish, BUBBLE_TIMEOUT)
    }
  }, [])

  // Process next notification from queue
  const processNextNotif = useCallback(() => {
    if (notifQueueRef.current.length === 0) {
      notifProcessingRef.current = false
      return
    }

    notifProcessingRef.current = true
    const item = notifQueueRef.current.shift()!
    setCurrentNotif(item)

    notifTimerRef.current = setTimeout(() => {
      setCurrentNotif(null)
      setTimeout(() => processNextNotif(), NOTIFICATION_GAP)
    }, NOTIFICATION_DELAY)
  }, [])

  // Enqueue talk
  const enqueueTalk = useCallback((item: TalkItem) => {
    talkQueueRef.current.push(item)
    if (!talkProcessingRef.current) {
      processNextTalk()
    }
  }, [processNextTalk])

  // Attach TTS to current or queued talk
  const attachTts = useCallback((ttsUrl: string) => {
    // If currently showing a message without TTS, play it now
    if (talkProcessingRef.current && talkAudioRef.current === null) {
      if (talkTimerRef.current) clearTimeout(talkTimerRef.current)

      const audio = new Audio(ttsUrl)
      audio.volume = 0.8
      talkAudioRef.current = audio

      const finish = () => {
        setCurrentMessage(null)
        talkAudioRef.current = null
        talkTimerRef.current = setTimeout(() => processNextTalk(), BUBBLE_GAP)
      }

      audio.onended = () => {
        talkTimerRef.current = setTimeout(finish, 1500)
      }
      audio.onerror = () => {
        talkTimerRef.current = setTimeout(finish, 3000)
      }
      audio.play().catch(() => {
        talkTimerRef.current = setTimeout(finish, 3000)
      })
      talkTimerRef.current = setTimeout(finish, 30000)
    }
  }, [processNextTalk])

  // Enqueue notification
  const enqueueNotif = useCallback((item: NotifItem) => {
    notifQueueRef.current.push(item)
    if (!notifProcessingRef.current) {
      processNextNotif()
    }
  }, [processNextNotif])

  useEffect(() => {
    const socket: Socket = io(SOCKET_URL, { transports: ["websocket"] })

    socket.on("connect", () => {
      console.log("socket connected")
      setConnected(true)
    })

    socket.on("disconnect", () => {
      console.log("socket disconnected")
      setConnected(false)
    })

    socket.on("crawd:talk", (data: { message: string; replyTo: string | null }) => {
      console.log("crawd:talk received", data)
      enqueueTalk({ text: data.message, replyTo: data.replyTo ?? null })
    })

    socket.on("crawd:tts", (data: { ttsUrl: string }) => {
      console.log("crawd:tts received", data)
      attachTts(data.ttsUrl)
    })

    socket.on("crawd:chat", (data: ChatMessage) => {
      setChatMessages((prev) => [...prev.slice(-49), data])
    })

    socket.on("crawd:notification", (data: { body: string; ttsUrl: string | null }) => {
      console.log("crawd:notification received", data)
      enqueueNotif({ body: data.body, ttsUrl: data.ttsUrl })
    })

    return () => {
      socket.disconnect()
      if (talkTimerRef.current) clearTimeout(talkTimerRef.current)
      if (notifTimerRef.current) clearTimeout(notifTimerRef.current)
      if (talkAudioRef.current) talkAudioRef.current.pause()
    }
  }, [enqueueTalk, attachTts, enqueueNotif])

  return (
    <div className="w-screen h-screen relative">
      <div className="absolute bottom-6 right-6">
        <span
          className="text-white text-xl uppercase"
          style={{
            fontFamily: '"SF Pro Rounded", sans-serif',
            fontWeight: 900,
            WebkitTextStroke: "5px black",
            paintOrder: "stroke fill",
          }}
        >
          x.com/crawdbot
        </span>
      </div>
      <div className="absolute top-6 right-5">
        <Chat messages={chatMessages} />
      </div>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <Notification body={currentNotif?.body ?? null} ttsUrl={currentNotif?.ttsUrl ?? null} />
      </div>
      <div className="absolute bottom-18 right-5.5 flex items-start gap-3">
        <OverlayBubble message={currentMessage?.text ?? null} replyTo={currentMessage?.replyTo ?? null} />
        <OverlayFace />
      </div>
      {/* Connection indicator (dev only) */}
      {import.meta.env.DEV && (
        <div className={`absolute top-2 left-2 w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
      )}
    </div>
  )
}
