import { DEFAULT_SETTINGS, mergeSettings } from '../src/shared/settings'

const params = new URLSearchParams(location.search)
const empty = params.get('state') === 'empty'
const listeners = new Map<string, Set<(...args: any[]) => void>>()
const emit = (channel: string, ...args: any[]) => listeners.get(channel)?.forEach((cb) => cb(...args))
let settings = mergeSettings(JSON.parse(localStorage.getItem('offkey-ui-settings') || 'null') ?? DEFAULT_SETTINGS)
let words = JSON.parse(localStorage.getItem('offkey-ui-words') || 'null') ?? (empty ? [] : [
  { id: 'word-1', word: 'Offkey', source: 'manual', language: 'en', createdAt: '2026-10-19' },
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
const bridge = {
  on(channel: string, cb: (...args: any[]) => void) { const set = listeners.get(channel) ?? new Set(); set.add(cb); listeners.set(channel, set); return () => set.delete(cb) },
  async invoke(channel: string, ...args: any[]): Promise<any> {
    if (channel === 'store:use') {
      if (args[0] === 'patch') { settings = mergeSettings({ ...settings, ...args[1], provider: { ...settings.provider, ...args[1]?.provider } }); localStorage.setItem('offkey-ui-settings', JSON.stringify(settings)); emit('store:changed', settings) }
      if (args[0] === 'reset') settings = mergeSettings(DEFAULT_SETTINGS)
      return settings
    }
    if (channel === 'db:history-list' || channel === 'db:history-latest') {
      const query = args[0] ?? {}; const items = history.filter((item) => (!query.mode || (query.mode === 'dictations' ? item.mode !== 'ask_anything' : item.mode === query.mode)) && (!query.search || item.refinedText.toLowerCase().includes(query.search.toLowerCase())))
      const offset = query.offset ?? 0
      return { items: items.slice(offset, offset + (query.limit ?? 50)), total: items.length, nextCursor: null }
    }
    if (channel === 'db:history-get') return history.find((item) => item.id === args[0])
    if (channel === 'db:history-delete') { history = history.filter((item) => item.id !== args[0]); return true }
    if (channel === 'db:history-clear') { history = []; return true }
    if (channel === 'dictionary:list') return words
    if (channel === 'dictionary:add') { if (params.get('fail') === 'save') throw new Error('UI fixture save failure'); words.push({ id: crypto.randomUUID(), word: args[0], source: 'manual', createdAt: new Date().toISOString() }); localStorage.setItem('offkey-ui-words', JSON.stringify(words)); return words.at(-1) }
    if (channel === 'dictionary:remove') { words = words.filter((item: any) => item.id !== args[0]); localStorage.setItem('offkey-ui-words', JSON.stringify(words)); return true }
    if (channel === 'dictionary:update') {
      if (params.get('fail') === 'save') throw new Error('UI fixture save failure')
      const entry = words.find((item: any) => item.id === args[0])
      if (!entry) throw new Error('词汇不存在')
      entry.word = args[1]; localStorage.setItem('offkey-ui-words', JSON.stringify(words)); return entry
    }
    if (channel === 'appearance:get-state') return { resolved: settings.appearancePreference === 'dark' ? 'dark' : 'light' }
    if (channel === 'appearance:set-preference') { emit('appearance:color-mode-changed', { resolved: args[0] === 'dark' ? 'dark' : 'light' }); return true }
    if (channel === 'i18n:get-language') return settings.language
    if (channel === 'i18n:set-language') { settings.language = args[0]; emit('store:changed', settings); emit('i18n:language-changed', args[0]); return args[0] }
    if (channel === 'page:floating-bar-click' && args[0] === 'translation-language') { settings.translationTargetLanguage = args[1]; emit('store:changed', settings); return true }
    if (channel.startsWith('permission:')) return true
    if (channel === 'audio:get-devices-async') return [{ deviceId: 'default', label: 'MacBook Pro Microphone', isDefault: true }]
    if (channel === 'troubleshooting:get-system-info') return { appVersion: '1.0.0', platform: 'darwin', arch: 'arm64' }
    if (channel === 'page:get-interactive-card-payload') return { title: '帮我整理这段想法', answer: '清晰的表达，从一句简单的话开始。\n\n自然地说出想法，不必急着组织措辞，让文字随着你的思路慢慢成形。', createdAt: Date.now() }
    if (channel === 'auth:get-current') return null
    if (channel === 'auth:is-logged-in') return false
    if (channel === 'recording-machine:state') return { phase: 'idle', context: { handsFree: false } }
    if (channel === 'page:open-settings-modal') emit('page:open-settings-modal', args[0] ?? 'general')
    if (channel === 'file:pick-and-parse-dictionary-csv') return { canceled: true }
    if (channel === 'sync:state') return { phase: 'idle', pending: 0 }
    return true
  },
  send() {},
  app: { platform: 'darwin', arch: 'arm64' }
}
;(window as any).offkey = bridge
;(window as any).ipcRenderer = bridge
document.documentElement.dataset.uiReview = 'fixture'
