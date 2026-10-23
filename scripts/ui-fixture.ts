import lottie from 'lottie-web/build/player/lottie_svg'
import { z } from 'zod'
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '../src/shared/settings'
import { providerActionSchema, updateProviderState } from '../src/shared/providers'
import { buildDictationUsage } from '../src/shared/usage'

const params = new URLSearchParams(location.search)
const empty = params.get('state') === 'empty'
const listeners = new Map<string, Set<(...args: any[]) => void>>()
const emit = (channel: string, ...args: any[]) => listeners.get(channel)?.forEach((cb) => cb(...args))
let settings = mergeSettings(JSON.parse(localStorage.getItem('sayrel-ui-settings') || 'null') ?? DEFAULT_SETTINGS)
let shortcutCaptureSessionId = 0
let words = JSON.parse(localStorage.getItem('sayrel-ui-words') || 'null') ?? (empty ? [] : [
  { id: 'word-1', word: 'Sayrel', source: 'manual', language: 'en', createdAt: '2026-10-19' },
  { id: 'word-2', word: 'Figma', source: 'auto', language: 'en', createdAt: '2026-10-19' },
  { id: 'word-3', word: 'TypeScript', source: 'manual', language: 'en', createdAt: '2026-10-19' }
])
let history = empty ? [] : [
  { id: 'history-1', refinedText: 'Hi team, a quick update on the project. The new interface is ready for review. Let me know what you think.', mode: 'voice_transcript', focusedAppName: 'Slack', status: 'completed', createdAt: '2026-10-19T09:40:00Z', duration: 42000 },
  { id: 'history-2', refinedText: 'Thanks for sending this over. I have reviewed the proposal and would love to discuss the next steps tomorrow.', mode: 'voice_transcript', focusedAppName: 'Gmail', status: 'completed', createdAt: '2026-10-19T08:30:00Z', duration: 34000 },
  { id: 'history-3', refinedText: 'Break the work into three steps: explore the reference, implement the interface, and review the result.', mode: 'ask_anything', focusedAppName: 'ChatGPT', status: 'completed', createdAt: '2026-10-18T08:10:00Z', duration: 22000 }
]
// Synthetic microphone for UI review only. No OS permission or physical input.
const fixtureMedia = new EventTarget()
const fixtureDevices = [
  { deviceId: 'fixture-built-in', kind: 'audioinput', label: 'MacBook Pro Microphone', groupId: 'built-in' },
  { deviceId: 'fixture-usb', kind: 'audioinput', label: 'USB Microphone', groupId: 'usb' }
]
Object.assign(fixtureMedia, {
  enumerateDevices: async () => fixtureDevices,
  async getUserMedia() {
    const context = new AudioContext()
    const oscillator = context.createOscillator(), gain = context.createGain(), destination = context.createMediaStreamDestination()
    gain.gain.value = 0.08; oscillator.connect(gain); gain.connect(destination); oscillator.start()
    void context.resume()
    const stream = destination.stream
    for (const track of stream.getTracks()) {
      const stop = track.stop.bind(track)
      track.stop = () => { stop(); oscillator.stop(); void context.close() }
    }
    return stream
  }
})
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: fixtureMedia })
function patchSettings({ partial }: { partial: Partial<Settings> }) {
  settings = mergeSettings({ ...settings, ...partial, provider: { ...settings.provider, ...partial.provider } })
  localStorage.setItem('sayrel-ui-settings', JSON.stringify(settings))
  if ('language' in partial) emit('i18n:language-changed', settings.language ?? 'en')
  if ('appearancePreference' in partial) emit('appearance:color-mode-changed', { colorMode: settings.appearancePreference, resolved: settings.appearancePreference === 'dark' ? 'dark' : 'light' })
  emit('store:changed', settings)
  return settings
}
const bridge = {
  on(channel: string, cb: (...args: any[]) => void) { const set = listeners.get(channel) ?? new Set(); set.add(cb); listeners.set(channel, set); return () => set.delete(cb) },
  async invoke(channel: string, ...args: any[]): Promise<any> {
    if (channel === 'providers:get') return settings.serviceProviders
    if (channel === 'providers:manage') {
      const action = providerActionSchema.parse(args[0])
      if (action.action === 'test') {
        await new Promise(resolve => setTimeout(resolve, 120))
        if (params.get('fail') === 'test') return { ok: false, message: "Model verification failed. Check model permissions.", latencyMs: 120 }
        return { ok: true, message: "Connection verified", latencyMs: 120 }
      }
      if (action.action === 'models') return ['fixture-discovered-model']
      if (params.get('fail') === 'save') throw new Error("Could not save. Please try again.")
      await new Promise(resolve => setTimeout(resolve, 180))
      settings = { ...settings, serviceProviders: updateProviderState(settings.serviceProviders, action) }
      localStorage.setItem('sayrel-ui-settings', JSON.stringify(settings)); emit('store:changed', settings)
      return settings.serviceProviders
    }
    if (channel === 'store:use') {
      if (args[0] === 'patch') return patchSettings({ partial: args[1] ?? {} })
      if (args[0] === 'reset') return patchSettings({ partial: DEFAULT_SETTINGS })
      return settings
    }
    if (channel === 'db:history-list' || channel === 'db:history-latest') {
      const query = args[0] ?? {}; const items = history.filter((item) => (!query.mode || (query.mode === 'dictations' ? item.mode !== 'ask_anything' : item.mode === query.mode)) && (!query.search || item.refinedText.toLowerCase().includes(query.search.toLowerCase())))
      const offset = query.offset ?? 0
      return { items: items.slice(offset, offset + (query.limit ?? 50)), total: items.length, nextCursor: null }
    }
    if (channel === 'db:history-usage') {
      return buildDictationUsage(history.filter(item => item.status === 'completed' && item.mode !== 'ask_anything' && new Date(item.createdAt).getTime() <= Date.now()))
    }
    if (channel === 'db:history-activity') {
      if (params.get('state') === 'activity') {
        const now = new Date()
        return { days: Array.from({ length: 291 }, (_, offset) => {
          const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
          const active = offset < 16 || offset >= 200 || offset >= 20 && offset < 188 && offset % 2 === 0
          return { date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`, count: active ? 1 + (offset * 13) % 15 : 0 }
        }) }
      }
      const counts = new Map<string, number>()
      for (const item of history) {
        if (item.status !== 'completed' || new Date(item.createdAt).getTime() > Date.now()) continue
        const date = new Date(item.createdAt)
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      return { days: [...counts].map(([date, count]) => ({ date, count })) }
    }
    if (channel === 'db:history-get') return history.find((item) => item.id === args[0])
    if (channel === 'db:history-delete') { history = history.filter((item) => item.id !== args[0]); return true }
    if (channel === 'db:history-delete-by-duration') {
      const before = history.length
      const cutoff = Date.now() - Number(args[0])
      history = history.filter(item => new Date(item.createdAt).getTime() >= cutoff)
      return before - history.length
    }
    if (channel === 'db:history-clear') { history = []; return true }
    if (channel === 'dictionary:list') return words
    if (channel === 'dictionary:add') { if (params.get('fail') === 'save') throw new Error('UI fixture save failure'); words.push({ id: crypto.randomUUID(), word: args[0], source: 'manual', createdAt: new Date().toISOString() }); localStorage.setItem('sayrel-ui-words', JSON.stringify(words)); return words.at(-1) }
    if (channel === 'dictionary:remove') { await new Promise(resolve => setTimeout(resolve, 180)); if (params.get('fail') === 'delete') throw new Error("Could not delete"); words = words.filter((item: any) => item.id !== args[0]); localStorage.setItem('sayrel-ui-words', JSON.stringify(words)); return true }
    if (channel === 'dictionary:update') {
      if (params.get('fail') === 'save') throw new Error('UI fixture save failure')
      const entry = words.find((item: any) => item.id === args[0])
      if (!entry) throw new Error("Word not found")
      entry.word = args[1]; localStorage.setItem('sayrel-ui-words', JSON.stringify(words)); return entry
    }
    if (channel === 'appearance:get-state') return { resolved: settings.appearancePreference === 'dark' ? 'dark' : 'light' }
    if (channel === 'appearance:set-preference') { patchSettings({ partial: { appearancePreference: args[0] } }); return { colorMode: settings.appearancePreference, resolved: settings.appearancePreference === 'dark' ? 'dark' : 'light' } }
    if (channel === 'i18n:get-language') return settings.language
    if (channel === 'i18n:set-language') { patchSettings({ partial: { language: args[0] } }); return settings.language }
    if (channel === 'page:floating-bar-click' && args[0] === 'translation-language') { patchSettings({ partial: { translationTargetLanguage: args[1] } }); return true }
    if (channel.startsWith('permission:')) {
      if (params.get('fail') === 'permission') { if (channel === 'permission:check-with-child-process') return false; throw new Error('Could not request permission') }
      if (channel === 'permission:update-auto-launch') patchSettings({ partial: { launchAtLogin: z.boolean().parse(args[0]) } })
      if (channel === 'permission:update-show-app-in-dock') patchSettings({ partial: { showInDock: z.boolean().parse(args[0]) } })
      return true
    }
    if (channel === 'keyboard:begin-shortcut-capture') return { native: false, sessionId: ++shortcutCaptureSessionId }
    if (channel === 'audio:get-devices-async') return [{ deviceId: 'default', label: 'MacBook Pro Microphone', isDefault: true }]
    if (channel === 'troubleshooting:get-system-info') return { appVersion: '1.0.0', platform: 'darwin', arch: 'arm64' }
    if (channel === 'page:get-interactive-card-payload') return { title:'Help me organize this idea', answer:'Clear writing starts with one simple sentence.\n\nSpeak naturally and let the words take shape as you think.', createdAt:Date.now() }
    if (channel === 'page:is-onboarding-window-visible') return location.pathname.endsWith('/onboarding.html')
    if (channel === 'updater:check-for-update') { await new Promise(resolve => setTimeout(resolve, 700)); return { skipped: 'dev-build' } }
    if (channel === 'clipboard:write-text' && params.get('fail') === 'clipboard') throw new Error('Could not copy')
    if (channel === 'recording-machine:state') return { phase: 'idle', context: { handsFree: false } }
    if (channel === 'page:open-settings-modal') emit('page:open-settings-modal', args[0] ?? 'general')
    if (channel === 'file:pick-and-parse-dictionary-csv') return { canceled: true }
    return true
  },
  send() {},
  app: { platform: 'darwin', arch: 'arm64' }
}
;(window as any).sayrel = bridge
;(window as any).ipcRenderer = bridge
document.documentElement.dataset.uiReview = 'fixture'

// Offline-only access to the same player used by the homepage for frame verification.
Object.assign(window, { __heroPlayer: lottie })
