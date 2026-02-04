import { useEffect, useState } from "react"

type OverlayBubbleProps = {
  message: string | null
  replyTo: string | null
}

function useTypewriter(text: string | null, speed = 30) {
  const [displayed, setDisplayed] = useState("")

  useEffect(() => {
    if (!text) {
      setDisplayed("")
      return
    }

    setDisplayed("")
    let i = 0
    const interval = setInterval(() => {
      i++
      setDisplayed(text.slice(0, i))
      if (i >= text.length) clearInterval(interval)
    }, speed)

    return () => clearInterval(interval)
  }, [text, speed])

  return displayed
}

export function OverlayBubble({ message, replyTo }: OverlayBubbleProps) {
  const displayed = useTypewriter(message)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(!!message)
  }, [message])

  if (!visible) return null

  return (
    <div className="animate-bubble-pop relative backdrop-blur-xl bg-black/80 border-2 border-emerald-400/70 rounded-3xl px-10 py-6 max-w-[520px] min-w-[300px] shadow-[0_0_30px_rgba(52,211,153,0.2)]">
      {replyTo && (
        <div className="mb-3 border-l-2 border-white/30 pl-3">
          <p className="text-white/50 text-base italic leading-snug">{replyTo}</p>
        </div>
      )}
      <p className="text-white text-2xl font-medium leading-relaxed">
        {displayed}
        {displayed.length < (message?.length ?? 0) && (
          <span
            className="inline-block w-[2px] h-[1em] bg-emerald-400 ml-0.5 align-middle"
            style={{ animation: "typewriter-blink 0.6s step-end infinite" }}
          />
        )}
      </p>
    </div>
  )
}
