import type { Settings, ShortcutBinding } from './settings'

export const SHORTCUT_KEYS = ['shortcut', 'translationShortcut', 'askAnythingShortcut'] as const
export type ShortcutKey = typeof SHORTCUT_KEYS[number]
export function bindingsFor(settings: Settings, key: ShortcutKey): ShortcutBinding[] {
  return [settings[key], ...(settings.additionalShortcuts?.[key] ?? [])].filter(binding => binding.enabled && binding.accelerator)
}
export function canonicalShortcut(accelerator: string): string {
  const aliases: Record<string, string> = { Cmd: 'Command', Ctrl: 'Control', Option: 'Alt', CommandOrControl: 'Command' }
  return accelerator.split('+').map(key => aliases[key] ?? key).sort().join('+')
}
export function validateShortcut(accelerator: string, used: string[]): string | null {
  const keys = accelerator.split('+')
  if (used.some(value => canonicalShortcut(value) === canonicalShortcut(accelerator))) return '此快捷键已在使用中'
  if (keys.length > 3) return '快捷键必须包含3个或更少的键'
  if (keys.every(key => /^[a-z0-9]$/i.test(key))) return '快捷键不能只包含字母和数字'
  if (keys.filter(key => /^[a-z]$/i.test(key)).length > 1) return '不能使用连续字母'
  if (keys.filter(key => /^[0-9]$/.test(key)).length > 1) return '不能使用连续数字'
  if (['Escape', 'Command+Q', 'Command+W', 'Command+Tab', 'Command+Space', 'Alt+Tab', 'Control+Alt+Delete'].some(value => canonicalShortcut(value) === canonicalShortcut(accelerator))) return '此快捷键已保留供系统使用'
  return null
}
export function normalizeTranslationTargets(targets: string[], current: string): { translationTargetLanguages: string[]; translationTargetLanguage: string } {
  const unique = [...new Set(targets.filter(value => typeof value === 'string' && value.length > 0))].slice(0, 3)
  if (!unique.length) unique.push(current || 'en')
  return { translationTargetLanguages: unique, translationTargetLanguage: unique.includes(current) ? current : unique[0] }
}
