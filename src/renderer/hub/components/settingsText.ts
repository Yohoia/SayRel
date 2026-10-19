import { useEffect, useState } from 'react'
import { useAppSettings } from '../state/settings'
import zh from '../../../../resources/locales/zh-CN/index.json'

const locales = import.meta.glob('../../../../resources/locales/*/index.json')
const source = { ...zh.common, ...zh.client } as Record<string, string>
const sourceKeys = new Map(Object.entries(source).filter(([, value]) => typeof value === 'string').map(([key, value]) => [value.replaceAll('Typeless', 'Offkey'), key]))
const cache = new Map<string, Record<string, string>>()
export const interfaceLanguages = Object.keys(locales).map(path => path.split('/').at(-2)!).filter(code => code !== 'en-US').map(code => ({
  value: code,
  label: new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code
}))
export function useSettingsText() {
  const { settings } = useAppSettings()
  const locale = settings.language ?? 'zh-CN'
  const [dictionary, setDictionary] = useState<Record<string, string>>(source)
  useEffect(() => {
    let active = true
    if (locale === 'zh-CN') { setDictionary(source); return }
    if (cache.has(locale)) { setDictionary(cache.get(locale)!); return }
    const loader = locales[`../../../../resources/locales/${locale}/index.json`]
    void loader?.().then((module: any) => {
      const data = module.default ?? module
      const next = { ...data.common, ...data.client }
      cache.set(locale, next)
      if (active) setDictionary(next)
    })
    return () => { active = false }
  }, [locale])
  return (text: string) => {
    const key = sourceKeys.get(text)
    return (key && dictionary[key] || text).replaceAll('Typeless', 'Offkey')
  }
}
