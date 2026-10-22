import type { CSSProperties } from 'react'

export const recordingBarAppearance = {
  width: 70,
  height: 34,
  padding: '4px 6px',
  borderRadius: 8,
  border: '1px solid var(--line-strong)',
  background: 'var(--recording-bar-background,var(--paper))',
  boxShadow: 'var(--shadow-popover)'
} satisfies CSSProperties

export const handsFreeBarAppearance = {
  ...recordingBarAppearance,
  width: 116,
  padding: '4px'
} satisfies CSSProperties

export const cancelRecordingActionAppearance = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  width: 24, height: 24, padding: 4, borderRadius: 3,
  background: 'var(--fill-selected)', color: 'var(--ink)',
  transition: 'width .2s ease-in-out,height .2s ease-in-out,opacity .1s,transform .2s ease-in-out'
} satisfies CSSProperties

export const finishRecordingActionAppearance = {
  ...cancelRecordingActionAppearance,
  background: 'var(--accent)', color: 'var(--accent-ink)', zIndex: 2
} satisfies CSSProperties
