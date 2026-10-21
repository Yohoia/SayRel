import type { CSSProperties } from 'react'
import reference from '../reference-icons.json'

type Name = Exclude<keyof typeof reference, 'logo'>

/** SVG paths and viewBoxes are copied from the shipped Typeless 2.8.2 UI. */
export function Icon({ name, size = 16, style, className }: { name: Name; size?: number; style?: CSSProperties; className?: string }) {
  const original = reference[name]
  return <svg width={size} height={size} viewBox={original.viewBox} aria-hidden="true" className={className} style={{ flexShrink: 0, ...style }}>{original.paths.map((p: any, i: number) => <path key={i} {...p} />)}</svg>
}
