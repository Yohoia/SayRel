import type { Settings, ShortcutBinding } from './settings'

export const SHORTCUT_KEYS = ['shortcut', 'translationShortcut', 'askAnythingShortcut', 'desktopCommandShortcut'] as const
export type ShortcutKey = typeof SHORTCUT_KEYS[number]
export function bindingsFor(settings: Settings, key: ShortcutKey): ShortcutBinding[] {
  return [settings[key], ...(settings.additionalShortcuts?.[key] ?? [])].filter(binding => binding?.enabled && binding.accelerator)
}
export function normalizeShortcut(accelerator: string): string {
  return [...new Set(accelerator.split('+').map(key => /^(?:KeyCode(?:179|63)|Globe)$/i.test(key) ? 'Fn' : key))].join('+')
}
export function shortcutLabels(accelerator: string): string[] {
  const labels: Record<string, string> = { LeftShift: 'Left Shift', RightShift: 'Right Shift', LeftControl: 'Left Control', RightControl: 'Right Control', LeftAlt: 'Left Alt', RightAlt: 'Right Alt', LeftCommand: 'Left Command', RightCommand: 'Right Command' }
  return normalizeShortcut(accelerator).split('+').map(key => labels[key] ?? key)
}
export function canonicalShortcut(accelerator: string): string {
  const aliases: Record<string, string> = { Cmd: 'Command', Ctrl: 'Control', Option: 'Alt', CommandOrControl: 'Command' }
  return normalizeShortcut(accelerator).split('+').map(key => aliases[key] ?? key).sort().join('+')
}
export function validateShortcut(accelerator: string, used: string[]): string | null {
  const keys = accelerator.split('+')
  if (used.some(value => canonicalShortcut(value) === canonicalShortcut(accelerator))) return "This shortcut is already in use"
  if (keys.length > 3) return "A shortcut can contain at most 3 keys"
  if (keys.every(key => /^[a-z0-9]$/i.test(key))) return "A shortcut cannot contain only letters and numbers"
  if (keys.filter(key => /^[a-z]$/i.test(key)).length > 1) return "Consecutive letters are not allowed"
  if (keys.filter(key => /^[0-9]$/.test(key)).length > 1) return "Consecutive numbers are not allowed"
  if (['Escape', 'Command+Q', 'Command+W', 'Command+Tab', 'Command+Space', 'Alt+Tab', 'Control+Alt+Delete'].some(value => canonicalShortcut(value) === canonicalShortcut(accelerator))) return "This shortcut is reserved by the system"
  return null
}
export function normalizeTranslationTargets(targets: string[], current: string): { translationTargetLanguages: string[]; translationTargetLanguage: string } {
  const unique = [...new Set(targets.filter(value => typeof value === 'string' && value.length > 0))].slice(0, 3)
  if (!unique.length) unique.push(current || 'en')
  return { translationTargetLanguages: unique, translationTargetLanguage: unique.includes(current) ? current : unique[0] }
}
