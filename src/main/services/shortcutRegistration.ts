import { globalShortcut } from 'electron'
import { keyboard } from '../lib/native'
import { createLogger } from '../lib/logger'
import { handleFallbackShortcut, resetHotkeyState, shortcutBindings } from './hotkeys'

const log = createLogger('shortcut-registration')
const registered = new Set<string>()
let lastTargets = ''

export function toElectronAccelerator(value: string): string | null {
  if (!value) return null
  // Electron cannot observe Globe/Fn. These alternatives are used only when
  // the native event tap is unavailable, never alongside it.
  const defaults: Record<string, string> = {
    Fn: 'CommandOrControl+Shift+Space',
    'Fn+Shift': 'CommandOrControl+Shift+Alt+Space',
    'Fn+LeftShift': 'CommandOrControl+Shift+Alt+Space',
    'Fn+Space': 'CommandOrControl+Alt+Space'
  }
  if (defaults[value]) return defaults[value]
  if (value.split('+').includes('Fn')) return null
  return value.replace(/\b(?:Left|Right)(?=Shift|Control|Ctrl|Alt|Command|Cmd)/g, '')
}

/** Re-publish edited bindings and keep exactly one keyboard input backend. */
export function refreshShortcutRegistrations(): boolean {
  let applied = true
  const bindings = shortcutBindings().filter(({ binding }) => binding?.enabled && binding.accelerator)
  const targets = JSON.stringify([...new Set(bindings.map(({ binding }) => binding.accelerator))])
  if (targets !== lastTargets) {
    try {
      const result = keyboard.updateTargetShortcuts?.(targets)
      if ((result !== undefined && result !== 0) || (keyboard.running && result === undefined)) {
        throw new Error('Native shortcut targets could not be applied')
      }
      resetHotkeyState()
      if (result === 0) lastTargets = targets
    } catch (error) {
      log.warn('failed to publish native shortcut targets', error)
      applied = !keyboard.running
    }
  }
  for (const accelerator of registered) globalShortcut.unregister(accelerator)
  registered.clear()
  if (keyboard.running) return applied
  for (const { binding } of bindings) {
    const accelerator = toElectronAccelerator(binding.accelerator)
    if (!accelerator) { applied = false; continue }
    if (registered.has(accelerator)) continue
    try {
      if (globalShortcut.register(accelerator, () => handleFallbackShortcut(binding.accelerator))) {
        registered.add(accelerator)
      } else {
        log.warn(`shortcut already in use: ${accelerator}`)
        applied = false
      }
    } catch (err) {
      log.warn(`failed to register ${accelerator}`, err)
      applied = false
    }
  }
  return applied
}
