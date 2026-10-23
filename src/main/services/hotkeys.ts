import type { KeyEvent } from '../lib/native'
import type { Mode } from '../../shared/constants'
import { bindingsFor, SHORTCUT_KEYS } from '../../shared/settingsControls'
import type { ShortcutBinding } from '../../shared/settings'
import { recordingMachine } from './recordingMachine'
import { settings } from '../lib/settings'
import { windows } from '../windows'
import { createLogger } from '../lib/logger'

const log = createLogger('hotkeys')
// Typeless DFvLNtQv, LONG_PRESS_MS and shortcut-session reducer.
const LONG_PRESS_MS = 600
let gesture: { combination: string; style: ShortcutBinding['style']; started: boolean } | null = null
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
    log.debug('shortcut released', { combination: event.combination, cancelled: !!event.cancelled, phase: recordingMachine.getState().phase, sourceCode: event.sourceCode, sourceType: event.sourceType })
    const released = gesture
    gesture = null
    clearLongPressTimer()
    if (event.cancelled) {
      if (released.started) void recordingMachine.dispatch({ type: 'CANCEL' })
    } else if (recordingMachine.getState().phase === 'long_pressing' || released.style === 'hold') {
      void recordingMachine.dispatch({ type: 'RELEASE' })
    } else if (released.started) {
      recordingMachine.setHandsFree(true)
    }
    return
  }

  if (event.combination === 'Escape') {
    clearLongPressTimer()
    if (recordingMachine.getState().phase !== 'idle') {
      void recordingMachine.dispatch({ type: 'CANCEL' })
    }
    if (gesture) gesture.started = false
    return
  }
  if (recordingMachine.isDisabled()) return
  const resolved = resolveBinding(event.combination)
  if (!resolved) return
  log.debug('shortcut pressed', { combination: event.combination, phase: recordingMachine.getState().phase, eventDelayMs: Date.now() - event.ts, sourceCode: event.sourceCode, sourceType: event.sourceType })
  const { binding, mode } = resolved
  if (gesture?.combination === event.combination) return

  if (gesture && event.replacedCombination === gesture.combination) {
    gesture.combination = event.combination
    gesture.style = binding.style
    // Fn then Shift/Space upgrades initialization; never submits the first mode.
    if (gesture.started && recordingMachine.getState().phase !== 'long_pressing') {
      if (['idle', 'error'].includes(recordingMachine.getState().phase)) void recordingMachine.start(mode)
      else recordingMachine.switchMode(mode)
    }
    return
  }
  if (gesture) return

  const phase = recordingMachine.getState().phase
  if (phase === 'finishing' || phase === 'long_pressing') return
  gesture = { combination: event.combination, style: binding.style, started: false }
  if (phase === 'starting' || phase === 'recording') {
    // Once hands-free recording has started, any configured speech key stops it.
    void recordingMachine.dispatch({ type: 'FINISH' })
    return
  }

  gesture.started = true
  windows.floatingBar.createWindow()
  windows.floatingBar.show()
  void recordingMachine.start(mode)
  recordingMachine.setHandsFree(false)
  if (binding.style === 'toggle') {
    longPressTimer = setTimeout(() => {
      longPressTimer = null
      log.debug('shortcut long hold', { phase: recordingMachine.getState().phase })
      if (gesture?.started) recordingMachine.setLongPressing()
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
  const modes = { shortcut: 'voice_transcript', translationShortcut: 'translation', askAnythingShortcut: 'ask_anything' } as const
  return [
    ...SHORTCUT_KEYS.flatMap(key => bindingsFor(config, key).map(binding => ({ binding, mode: modes[key] }))),
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
