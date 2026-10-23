export function WaveformBars({ values, active, width, height = 24, barWidth = 2, gap = 2, color = 'var(--ink)', inactiveColor = 'var(--ink-tertiary)', borderRadius = 1 }: {
  values: readonly number[]
  active: boolean
  width: number
  height?: number
  barWidth?: number
  gap?: number
  color?: string
  inactiveColor?: string
  borderRadius?: number
}) {
  const count = values.length
  return <div data-testid="waveform" style={{ flex: 1, width, height, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', position: 'relative', overflow: 'hidden', gap, pointerEvents: 'none' }}>
    {values.map((volume, index) => {
      const center = Math.floor(count / 2)
      const delay = index < center - 1 ? ((count % 2 === 0 ? center - 1 : center) - index) * .5 / count : (index - center) * .5 / count
      return <div key={index} data-testid="audio-bar" style={{ width: barWidth, height: volume, backgroundColor: active ? color : inactiveColor, borderRadius, flexShrink: 0, transitionProperty: 'width, background-color', transitionDuration: `0.08s, ${active ? '.2s' : '0s'}`, transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1), ease', transitionDelay: `0s, ${active ? delay : 0}s` }} />
    })}
  </div>
}
