import type { CSSProperties } from 'react'

export const recordingBarAppearance = {
  width: 70,
  height: 34,
  padding: '4px 6px',
  borderRadius: 99,
  border: '1px solid color-mix(in srgb,var(--accent-ink) 32%,transparent)',
  background: 'var(--recording-bar-background,var(--accent))',
  boxShadow: '0px 0px 20px 0px rgba(0,0,0,.15),0px 25px 30px 0px rgba(0,0,0,.25)'
} satisfies CSSProperties

export const handsFreeBarAppearance = {
  ...recordingBarAppearance,
  width: 116,
  padding: '4px'
} satisfies CSSProperties

export const cancelRecordingActionAppearance = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  width: 24, height: 24, padding: 4, borderRadius: 12,
  background: 'color-mix(in srgb,var(--accent-ink) 26%,var(--accent))', color: 'var(--accent-ink)',
  transition: 'width .2s ease-in-out,height .2s ease-in-out,opacity .1s,transform .2s ease-in-out'
} satisfies CSSProperties

export const finishRecordingActionAppearance = {
  ...cancelRecordingActionAppearance,
  background: 'var(--accent-ink)', color: 'var(--accent)', zIndex: 2
} satisfies CSSProperties
