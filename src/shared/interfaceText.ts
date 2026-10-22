import en from '../../resources/locales/en/index.json'
import zh from '../../resources/locales/zh-CN/index.json'
import appZh from '../../resources/locales/zh-CN/app.json'

export const english: Record<string, string> = { ...en.common, ...en.client }
export const chinese: Record<string, string> = { ...zh.common, ...zh.client }
export type SettingsTextKey = keyof typeof zh.common | keyof typeof zh.client
const brandText = (text: string) => text.replaceAll('Typeless', 'Sayrel')
const sourceKeys = new Map([...Object.entries(chinese), ...Object.entries(english)].map(([key, value]) => [brandText(value), key]))
const supplemental: Record<string, string> = appZh
const templates = Object.entries(supplemental).filter(([text]) => text.includes('{{')).map(([text, translated]) => {
  const names: string[] = []
  const pattern = text.split(/(\{\{\w+\}\})/).map(part => {
    if (part.startsWith('{{')) { names.push(part.slice(2, -2)); return '(.+?)' }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }).join('')
  return { pattern:new RegExp('^' + pattern + '$'), names, translated }
})

export function translateInterface(text: string, locale: string, dictionary?: Record<string, string>, translationKey?: SettingsTextKey): string {
  const normalized = brandText(text)
  const trimmed = normalized.trim()
  const key = translationKey ?? sourceKeys.get(trimmed)
  const chineseLocale = locale === 'zh' || locale === 'zh-CN' || locale === 'zh-SG'
  const translations = dictionary ?? (chineseLocale ? chinese : english)
  let translated = key && translations[key] || trimmed
  let interpolated = false
  if (chineseLocale && !translationKey) {
    translated = supplemental[trimmed] ?? translated
    if (translated === trimmed) for (const template of templates) {
      const match = template.pattern.exec(text.trim())
      if (!match) continue
      translated = template.translated.replace(/\{\{(\w+)\}\}/g, (_, name: string) => match[template.names.indexOf(name) + 1] ?? '')
      interpolated = true
      break
    }
  }
  return text.slice(0, text.length - text.trimStart().length) + (interpolated ? translated : brandText(translated)) + text.slice(text.trimEnd().length)
}
