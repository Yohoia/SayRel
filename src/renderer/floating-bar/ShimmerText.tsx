import { useEffect, useRef, useState } from 'react'

const DEFAULTS = {
  speed: 320,
  shimmerWidth: 60,
  angle: 115,
  waitMs: 1200,
  dim: 'var(--ink-tertiary)',
  high: 'var(--ink)'
}

/**
 * Text with a highlight sweeping across it. The animation duration is derived
 * from the measured width so the sweep speed is constant regardless of label
 * length, then pauses for `waitMs` before repeating.
 */
export function ShimmerText({
  children,
  active = false,
  fontSize = 13,
  fontWeight = 500,
  speed = DEFAULTS.speed,
  shimmerWidth = DEFAULTS.shimmerWidth,
  angle = DEFAULTS.angle,
  waitMs = DEFAULTS.waitMs,
  dim = DEFAULTS.dim,
  high = DEFAULTS.high,
  lineHeight,
  blur = 0
}: {
  children: React.ReactNode
  active?: boolean
  fontSize?: number
  fontWeight?: number
  speed?: number
  shimmerWidth?: number
  angle?: number
  waitMs?: number
  dim?: string
  high?: string
  lineHeight?: string
  blur?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [animation, setAnimation] = useState({ duration: '1s', breakpoint: 50 })

  useEffect(() => {
    if (!ref.current || !active) return
    const travel = ((ref.current.offsetWidth + shimmerWidth) / speed) * 1000
    const total = travel + waitMs
    setAnimation({
      duration: `${total}ms`,
      breakpoint: (travel / total) * 100
    })
  }, [children, active, shimmerWidth, speed, waitMs])

  const name = `shimmer-${Math.round(animation.breakpoint)}`

  return (
    <>
      <style>{`
        @keyframes loadingMove {
          0% { transform: translateX(-27px); }
          100% { transform: translateX(54px); }
        }
        @keyframes ${name} {
          0% { background-position: 150% 0; }
          ${animation.breakpoint}% { background-position: -50% 0; }
          100% { background-position: -50% 0; }
        }
      `}</style>
      <span
        ref={ref}
        style={{
          position: 'relative',
          fontFamily: '"SF Pro", -apple-system, BlinkMacSystemFont, Arial, sans-serif',
          fontSize,
          fontWeight,
          lineHeight,
          transition: 'opacity 0.3s ease, color 0.3s ease',
          whiteSpace: 'nowrap',
          color: active ? dim : high
        }}
      >
        <span style={{ position: 'relative', zIndex: 1 }}>{children}</span>
        {active && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 2,
              filter: blur ? `blur(${blur}px)` : undefined,
              pointerEvents: 'none',
              backgroundImage: `linear-gradient(${angle}deg,
                transparent calc(50% - ${shimmerWidth / 2}px),
                ${high} calc(50% - ${shimmerWidth / 6}px),
                ${high} calc(50% + ${shimmerWidth / 6}px),
                transparent calc(50% + ${shimmerWidth / 2}px))`,
              backgroundSize: '200% 100%',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              animation: `${name} ${animation.duration} ease-out infinite`
            }}
          >
            {children}
          </span>
        )}
      </span>
    </>
  )
}
