import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useAppSettings } from '../state/settings'
import zh from '../../../../resources/locales/zh-CN/index.json'
import en from '../../../../resources/locales/en/index.json'

const locales = import.meta.glob('../../../../resources/locales/*/index.json')
const source: Record<string, string> = { ...zh.common, ...zh.client }
const english: Record<string, string> = { ...en.common, ...en.client }
export type SettingsTextKey = keyof typeof zh.common | keyof typeof zh.client
const brandText = (text: string) => text.replaceAll('Typeless', 'Sayrel').replaceAll('Offkey', 'Sayrel')
const sourceKeys = new Map([...Object.entries(source), ...Object.entries(english)].map(([key, value]) => [brandText(value), key]))
const localeSchema = z.object({ common: z.record(z.string(), z.string()), client: z.record(z.string(), z.string()) })
const cache = new Map<string, Record<string, string>>([['en', english], ['zh-CN', source]])
export const interfaceLanguages = Object.keys(locales).map(path => path.split('/').at(-2)!).filter(code => code !== 'en-US').map(code => ({
  value: code,
  label: new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code
}))
export function useSettingsText() {
  const { settings } = useAppSettings()
  const locale = settings.language ?? 'en'
  const [loaded, setLoaded] = useState({ locale: 'en', dictionary: english })
  useEffect(() => {
    let active = true
    if (cache.has(locale)) return
    const loader = locales[`../../../../resources/locales/${locale}/index.json`]
    void loader?.().then((module) => {
      const data = localeSchema.parse(module && typeof module === 'object' && 'default' in module ? module.default : module)
      const next = { ...data.common, ...data.client }
      cache.set(locale, next)
      if (active) setLoaded({ locale, dictionary: next })
    }).catch(() => { if (active) setLoaded({ locale, dictionary: english }) })
    return () => { active = false }
  }, [locale])
  const dictionary = cache.get(locale) ?? (loaded.locale === locale ? loaded.dictionary : english)
  return (text: string, translationKey?: SettingsTextKey) => {
    const key = translationKey ?? sourceKeys.get(brandText(text))
    return brandText(key && dictionary[key] || text)
  }
}
