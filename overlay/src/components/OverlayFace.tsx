import { useEffect, useRef, useState } from "react"

function useAutonomousGaze() {
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const look = () => {
      const x = (Math.random() - 0.5) * 16
      const y = (Math.random() - 0.5) * 10
      setOffset({ x, y })
    }

    const scheduleNext = () => {
      const delay = 800 + Math.random() * 2500
      return setTimeout(() => {
        look()
        timerId = scheduleNext()
      }, delay)
    }

    let timerId = scheduleNext()
    return () => clearTimeout(timerId)
  }, [])

  return offset
}

export function OverlayFace() {
  const [blinking, setBlinking] = useState(false)
  const faceRef = useRef<HTMLDivElement>(null)
  const offset = useAutonomousGaze()

  useEffect(() => {
    const blink = () => {
      setBlinking(true)
      setTimeout(() => setBlinking(false), 150)
    }

    const scheduleNextBlink = () => {
      const delay = 2000 + Math.random() * 4000
      return setTimeout(() => {
        blink()
        timerId = scheduleNextBlink()
      }, delay)
    }

    let timerId = scheduleNextBlink()
    return () => clearTimeout(timerId)
  }, [])

  const scaleY = blinking ? 0.05 : 1
  const eyeTransform = `translate(${offset.x}px, ${offset.y}px) scaleY(${scaleY})`
  const shadowX = -offset.x * 1.5
  const shadowY = -offset.y * 1.5
  const eyeShadow = `${shadowX}px ${shadowY}px 12px 2px rgba(0, 0, 0, 0.12)`

  return (
    <div
      ref={faceRef}
      className="flex flex-col shrink-0 animate-float corner-squircle rounded-[30%] w-[200px] h-[200px] items-center justify-center bg-gradient-to-br from-[#FBA875] to-[#E67732]"
    >
      {/* Eyes */}
      <div className="flex justify-center gap-6 mb-3.5">
        <div
          className="rounded-sm bg-gradient-to-b from-black to-[#303030]"
          style={{
            width: 36,
            height: 50,
            transform: eyeTransform,
            boxShadow: eyeShadow,
            transition: "transform 0.3s ease-out, box-shadow 0.3s ease-out",
          }}
        />
        <div
          className="rounded-sm bg-gradient-to-b from-black to-[#303030]"
          style={{
            width: 36,
            height: 50,
            transform: eyeTransform,
            boxShadow: eyeShadow,
            transition: "transform 0.3s ease-out, box-shadow 0.3s ease-out",
          }}
        />
      </div>
      {/* Mouth */}
      <div className="flex justify-center">
        <div
          className="rounded-sm bg-gradient-to-b from-black to-[#303030]"
          style={{ width: "11px", height: "5px" }}
        />
      </div>
    </div>
  )
}
