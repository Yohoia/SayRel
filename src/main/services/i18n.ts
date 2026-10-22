import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { app } from 'electron'
import { settings } from '../lib/settings'
import { broadcast } from '../windows'
import { IPC } from '../../shared/ipc'
import { createLogger } from '../lib/logger'

const log = createLogger('i18n')
const run = promisify(execFile)

/** Locale ids shipped under resources/locales. */
export const SUPPORTED_LOCALES = [
  'am', 'ar-EG', 'ar-SA', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'en-GB',
  'es', 'es-MX', 'et', 'fa', 'fi', 'fil', 'fr', 'fr-CA', 'gu', 'he', 'hi', 'hr', 'hu', 'hy', 'id',
  'it', 'ja', 'kn', 'ko', 'lt', 'lv', 'ml', 'mr', 'ms', 'nb', 'nl', 'pl', 'pt-BR',
  'pt-PT', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tr', 'uk',
  'ur', 'vi', 'zh-CN', 'zh-HK', 'zh-TW', 'zu'
] as const

const LOCALE_MAP: Record<string, string> = {
  en_US: 'en',
  'en-US': 'en',
  'en-GB': 'en-GB',
  zh_CN: 'zh-CN',
  zh_TW: 'zh-TW',
  es_419: 'es-MX',
  'es-419': 'es-MX',
  pt_BR: 'pt-BR',
  pt_PT: 'pt-PT'
}

export async function detectSystemLanguage(): Promise<string> {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await run('defaults', ['read', 'NSGlobalDomain', 'AppleLanguages'])
      const match = stdout.match(/"?([a-zA-Z]{2,3}[-_][A-Za-z0-9]{2,4})"?/)
      if (match) return match[1]
    } catch (err) {
      log.warn('failed to read AppleLanguages', err)
    }
  }
  return app.getLocale() || 'en'
}

export function normalizeLocale(raw: string): string {
  const direct = LOCALE_MAP[raw]
  if (direct) return direct
  if (SUPPORTED_LOCALES.includes(raw as any)) return raw
  const base = raw.split(/[-_]/)[0]
  const candidate = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === base.toLowerCase())
  return candidate ?? 'en'
}

export async function getLanguage(): Promise<string> {
  const configured = settings.get().language
  if (configured) return configured
  return normalizeLocale(await detectSystemLanguage())
}

export function setLanguage(locale: string): string {
  const next = normalizeLocale(locale)
  broadcast('store:changed', settings.patch({ language: next }))
  broadcast(IPC.I18N_LANGUAGE_CHANGED, next)
  return next
}

export async function resetToSystemLanguage(): Promise<string> {
  const detected = normalizeLocale(await detectSystemLanguage())
  broadcast('store:changed', settings.patch({ language: null }))
  broadcast(IPC.I18N_LANGUAGE_CHANGED, detected)
  return detected
}
