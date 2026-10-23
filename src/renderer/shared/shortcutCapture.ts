import { z } from 'zod'

const captureSessionSchema = z.object({
  native: z.boolean(),
  sessionId: z.number().int().positive().brand<'ShortcutCaptureSessionId'>()
})
const shortcutEventSchema = z.object({
  sessionId: z.number().int().positive(),
  combination: z.string(),
  pressed: z.boolean()
})

type CaptureSessionId = z.infer<typeof captureSessionSchema>['sessionId']
type CaptureAdapter = { kind: 'native'; sessionId: CaptureSessionId } | { kind: 'browser'; sessionId: CaptureSessionId }

export type ShortcutCaptureEvent =
  | { type: 'shortcut'; combination: string; pressed: boolean }
  | { type: 'cancel' }

export interface ShortcutCaptureBridge {
  on(channel: string, callback: (event: unknown) => void): () => void
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

export interface ShortcutCapture {
  ready: Promise<CaptureAdapter>
  stop(): Promise<void>
}

type BrowserTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>
type PendingEvent =
  | { source: 'native'; sessionId: number; event: ShortcutCaptureEvent }
  | { source: 'browser'; event: ShortcutCaptureEvent }

const modifierKeys = new Set(['Meta', 'Control', 'Alt', 'Shift', 'Fn'])
const keyNames: Record<string, string> = {
  ' ': 'Space', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down'
}

function modifierFor(event: KeyboardEvent): string | null {
  if (event.key === 'Meta') return 'Command'
  if (event.key === 'Control') return 'Control'
  if (event.key === 'Alt') return 'Alt'
  if (event.key === 'Fn') return 'Fn'
  if (event.key !== 'Shift') return null
  return event.code === 'ShiftLeft' ? 'LeftShift' : event.code === 'ShiftRight' ? 'RightShift' : 'Shift'
}

function browserCombination(event: KeyboardEvent, heldModifiers: Map<string, string>): string {
  const parts: string[] = []
  if (event.metaKey || event.key === 'Meta') parts.push('Command')
  if (event.ctrlKey || event.key === 'Control') parts.push('Control')
  if (event.altKey || event.key === 'Alt') parts.push('Alt')
  if (event.shiftKey || event.key === 'Shift') {
    const side = [...heldModifiers].find(([code]) => code === 'ShiftLeft' || code === 'ShiftRight')?.[1]
    parts.push(side ?? (event.key === 'Shift' ? modifierFor(event) : null) ?? 'Shift')
  }
  if (event.getModifierState('Fn') || event.key === 'Fn') parts.push('Fn')
  if (!modifierKeys.has(event.key) && event.key !== 'Unidentified') {
    parts.push(keyNames[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key))
  }
  return parts.join('+')
}

export function startShortcutCapture({ bridge, onEvent, shouldPreventDefault = () => true, target = window }: {
  bridge: ShortcutCaptureBridge
  onEvent: (event: ShortcutCaptureEvent) => void
  shouldPreventDefault?: (event: ShortcutCaptureEvent) => boolean
  target?: BrowserTarget
}): ShortcutCapture {
  let active = true
  let session: z.infer<typeof captureSessionSchema> | null = null
  let stopPromise: Promise<void> | null = null
  const pending: PendingEvent[] = []
  const heldModifiers = new Map<string, string>()

  const publish = (entry: PendingEvent) => {
    if (!active || !session) return
    if (entry.source === 'native' && (session.native !== true || entry.sessionId !== session.sessionId)) return
    if (entry.source === 'browser' && session.native) return
    onEvent(entry.event)
  }
  const enqueue = (entry: PendingEvent) => {
    if (!session) pending.push(entry)
    else publish(entry)
  }
  const preventDefault = (event: KeyboardEvent, input: ShortcutCaptureEvent) => {
    if (!shouldPreventDefault(input)) return
    event.preventDefault()
    event.stopPropagation()
  }

  const unsubscribe = bridge.on('keyboard:shortcut-captured', raw => {
    const parsed = shortcutEventSchema.safeParse(raw)
    if (!parsed.success || !active) return
    const event: ShortcutCaptureEvent = parsed.data.combination === 'Escape'
      ? { type: 'cancel' }
      : { type: 'shortcut', combination: parsed.data.combination, pressed: parsed.data.pressed }
    enqueue({ source: 'native', sessionId: parsed.data.sessionId, event })
  })

  const keydown = (event: KeyboardEvent) => {
    if (!active || event.repeat || event.isComposing) return
    if (event.key === 'Escape') {
      preventDefault(event, { type: 'cancel' })
      onEvent({ type: 'cancel' })
      return
    }
    const modifier = modifierFor(event)
    if (modifier) heldModifiers.set(event.code, modifier)
    const combination = browserCombination(event, heldModifiers)
    if (!combination) return
    const input: ShortcutCaptureEvent = { type: 'shortcut', combination, pressed: true }
    preventDefault(event, input)
    enqueue({ source: 'browser', event: input })
  }
  const keyup = (event: KeyboardEvent) => {
    if (!active || event.isComposing) return
    const combination = browserCombination(event, heldModifiers)
    if (combination) {
      const input: ShortcutCaptureEvent = combination === 'Escape' ? { type: 'cancel' } : { type: 'shortcut', combination, pressed: false }
      preventDefault(event, input)
      if (input.type === 'shortcut') enqueue({ source: 'browser', event: input })
    }
    heldModifiers.delete(event.code)
  }

  target.addEventListener('keydown', keydown, true)
  target.addEventListener('keyup', keyup, true)

  const ready = bridge.invoke('keyboard:begin-shortcut-capture').then(raw => {
    const parsed = captureSessionSchema.parse(raw)
    session = parsed
    if (active) {
      for (const entry of pending.splice(0)) publish(entry)
    } else {
      pending.length = 0
    }
    return parsed.native
      ? { kind: 'native', sessionId: parsed.sessionId } satisfies CaptureAdapter
      : { kind: 'browser', sessionId: parsed.sessionId } satisfies CaptureAdapter
  }).catch(error => {
    active = false
    unsubscribe()
    target.removeEventListener('keydown', keydown, true)
    target.removeEventListener('keyup', keyup, true)
    pending.length = 0
    throw error
  })

  return {
    ready,
    stop() {
      if (stopPromise) return stopPromise
      active = false
      unsubscribe()
      target.removeEventListener('keydown', keydown, true)
      target.removeEventListener('keyup', keyup, true)
      pending.length = 0
      stopPromise = ready.then(async () => {
        if (session) await bridge.invoke('keyboard:end-shortcut-capture', session.sessionId)
      }, () => undefined).then(() => undefined, () => undefined)
      return stopPromise
    }
  }
}
