import { useEffect, useMemo, useRef } from "react"

export type ChatPlatform = 'pumpfun' | 'youtube' | 'twitch' | 'twitter'

export type ChatMessage = {
  id: string
  username: string
  message: string
  platform?: ChatPlatform
  metadata?: {
    superChat?: {
      amountDisplayString: string
      backgroundColor: string
    }
  }
}

const MAX_MESSAGES = 50

const TWITCH_COLORS = [
  "#FF4500", "#FF6900", "#FFB300", "#1E90FF", "#9ACD32",
  "#FF69B4", "#00FF7F", "#B22222", "#DAA520", "#5F9EA0",
  "#2E8B57", "#D2691E", "#8A2BE2", "#FF7F50", "#00CED1",
]

const platformBadge: Record<ChatPlatform, { label: string; bg: string }> = {
  pumpfun: { label: 'PF', bg: 'bg-orange-500' },
  youtube: { label: 'YT', bg: 'bg-red-600' },
  twitch: { label: 'TW', bg: 'bg-purple-600' },
  twitter: { label: 'X', bg: 'bg-neutral-800' }
}

function hashColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return TWITCH_COLORS[Math.abs(hash) % TWITCH_COLORS.length]
}

function truncate(str: string): string {
  if (str.length <= 8) return str
  return `${str.slice(0, 4)}...${str.slice(-4)}`
}

export function Chat({ messages }: { messages: ChatMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const visible = messages.slice(-MAX_MESSAGES)

  return (
    <div className="flex h-[420px] w-[380px] flex-col overflow-hidden rounded-md bg-black/80">
      <div className="text-white text-lg px-2 py-1">Livestream Chat</div>
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5 scrollbar-hide">
        {visible.map((msg) => (
          <ChatLine key={msg.id} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function ChatLine({ msg }: { msg: ChatMessage }) {
  const color = useMemo(() => hashColor(msg.username || msg.id), [msg.username, msg.id])
  const displayName = truncate(msg.username || msg.id)
  const badge = msg.platform ? platformBadge[msg.platform] : null

  return (
    <div className="animate-fade-in flex items-start gap-1 leading-6">
      <span>
        {badge && (
          <span className={`text-[10px] px-1 py-0.5 rounded font-bold text-white mr-1 ${badge.bg}`}>
            {badge.label}
          </span>
        )}
        <span
          className="font-bold text-base"
          style={{ color }}
        >
          {displayName}
        </span>
        <span className="text-white/50 text-base">: </span>
        <span className="text-white text-base break-words">
          {msg.message}
        </span>
        {msg.metadata?.superChat && (
          <span
            className="ml-1 px-1 rounded text-xs font-bold text-white"
            style={{ backgroundColor: msg.metadata.superChat.backgroundColor }}
          >
            {msg.metadata.superChat.amountDisplayString}
          </span>
        )}
      </span>
    </div>
  )
}
