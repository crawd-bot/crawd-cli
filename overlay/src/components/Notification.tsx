import { useEffect, useRef } from "react"

const DONATION_SOUNDS = ["/assets/donation/twitch-default.mp3"]

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

type NotificationProps = {
  body: string | null
  ttsUrl: string | null
}

export function Notification({ body, ttsUrl }: NotificationProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!body) return

    const donationAudio = new Audio(pickRandom(DONATION_SOUNDS))
    audioRef.current = donationAudio

    if (ttsUrl) {
      donationAudio.onended = () => {
        const ttsAudio = new Audio(ttsUrl)
        ttsAudio.volume = 0.25
        audioRef.current = ttsAudio
        ttsAudio.play()
      }
    }

    donationAudio.play()

    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
      }
    }
  }, [body, ttsUrl])

  if (!body) return null

  return (
    <div className="flex items-center justify-center">
      <div
        className="animate-notification flex flex-col items-center gap-5 max-w-[600px]"
        style={{ fontFamily: "'SF Pro Rounded', -apple-system, BlinkMacSystemFont, sans-serif" }}
      >
        <div className="text-6xl animate-wiggle">🦀</div>
        <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-[#1a1a2e] to-[#16213e] px-10 py-8 text-center shadow-[0_0_60px_rgba(99,102,241,0.3)]">
          <p className="text-4xl font-bold text-white leading-snug">{body}</p>
        </div>
      </div>
    </div>
  )
}
