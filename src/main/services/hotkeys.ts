import type { KeyEvent } from '../lib/native'
import type { Mode } from '../../shared/constants'
import { bindingsFor, SHORTCUT_KEYS } from '../../shared/settingsControls'
import type { ShortcutBinding } from '../../shared/settings'
import { recordingMachine } from './recordingMachine'
import { settings } from '../lib/settings'
import { createLogger } from '../lib/logger'

const log = createLogger('hotkeys')
// Typeless DFvLNtQv, LONG_PRESS_MS and shortcut-session reducer.
const LONG_PRESS_MS = 600
let gesture: { id: symbol; combination: string; style: ShortcutBinding['style'] } | null = null
let longPressTimer: ReturnType<typeof setTimeout> | null = null

function clearLongPressTimer(): void {
  if (longPressTimer) clearTimeout(longPressTimer)
  longPressTimer = null
}

/** Native events describe one physical gesture, including chord upgrades. */
export function handleKeyEvent(event: KeyEvent): void {
  if (event.capture) return
  // Always clear releases, even after a binding was edited or disabled.
  if (!event.pressed) {
    if (!gesture || gesture.combination !== event.combination) return
    log.debug('shortcut released', { combination: event.combination, cancelled: !!event.cancelled, sourceCode: event.sourceCode, sourceType: event.sourceType })
    const released = gesture
    gesture = null
    clearLongPressTimer()
    void recordingMachine.dispatch({ type: 'SHORTCUT_RELEASE', gestureId: released.id,
      action: event.cancelled ? 'cancel' : released.style === 'hold' ? 'finish' : 'hands-free' })
    return
  }

  if (event.combination === 'Escape') {
    clearLongPressTimer()
    void recordingMachine.dispatch({ type: 'CANCEL' })
    return
  }
  const resolved = resolveBinding(event.combination)
  if (!resolved) return
  log.debug('shortcut pressed', { combination: event.combination, eventDelayMs: Date.now() - event.ts, sourceCode: event.sourceCode, sourceType: event.sourceType })
  const { binding, mode } = resolved
  if (gesture?.combination === event.combination) return

  if (gesture && event.replacedCombination === gesture.combination) {
    gesture.combination = event.combination
    gesture.style = binding.style
    void recordingMachine.dispatch({ type: 'SHORTCUT_UPGRADE', gestureId: gesture.id, mode })
    return
  }
  if (gesture) return

  const pressed = { id: Symbol(event.combination), combination: event.combination, style: binding.style }
  gesture = pressed
  void recordingMachine.dispatch({ type: 'SHORTCUT_PRESS', gestureId: pressed.id, mode })
  if (binding.style === 'toggle') {
    longPressTimer = setTimeout(() => {
      longPressTimer = null
      log.debug('shortcut long hold', { combination: pressed.combination })
      void recordingMachine.dispatch({ type: 'SHORTCUT_LONG_PRESS', gestureId: pressed.id })
    }, LONG_PRESS_MS)
  }
}

/** Electron has no global key-up callback: its fallback is explicitly a toggle. */
export function handleFallbackShortcut(combination: string): void {
  const resolved = resolveBinding(combination)
  if (!resolved) return
  void recordingMachine.dispatch({ type: 'TOGGLE', mode: resolved.mode })
}

export function shortcutBindings(): { binding: ShortcutBinding; mode: Mode }[] {
  const config = settings.get()
  const modes = { shortcut: 'voice_transcript', translationShortcut: 'translation', askAnythingShortcut: 'ask_anything', desktopCommandShortcut: 'desktop_command' } as const
  return [
    ...SHORTCUT_KEYS.filter(key => key !== 'desktopCommandShortcut' || config.desktopCommandsEnabled).flatMap(key => bindingsFor(config, key).map(binding => ({ binding, mode: modes[key] }))),
    { binding: config.commandShortcut, mode: 'voice_command' }
  ]
}

function resolveBinding(combination: string) {
  return shortcutBindings().find(({ binding }) => binding?.enabled && binding.accelerator === combination)
}

export function resetHotkeyState(): void {
  clearLongPressTimer()
  gesture = null
  log.debug('hotkey state reset')
}
