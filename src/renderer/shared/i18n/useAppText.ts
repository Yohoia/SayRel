import { useCallback, useEffect, useState } from 'react'
import { z } from 'zod'
import { useAppSettings } from '../state/settings'
import { chinese, english, translateInterface, type SettingsTextKey } from '../../../shared/interfaceText'
export type { SettingsTextKey } from '../../../shared/interfaceText'

const locales = import.meta.glob('../../../../resources/locales/*/index.json')
const localeSchema = z.object({ common: z.record(z.string(), z.string()), client: z.record(z.string(), z.string()) })
const cache = new Map<string, Record<string, string>>([['en', english], ['zh-CN', chinese]])
export const interfaceLanguages = Object.keys(locales).map(path => path.split('/').at(-2)!).filter(code => code !== 'en-US').map(code => ({
  value: code,
  label: new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code
}))
export function useAppText() {
  const { locale } = useAppSettings()
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
  return useCallback((text: string, translationKey?: SettingsTextKey) => translateInterface(text, locale, dictionary, translationKey), [locale, dictionary])
}
