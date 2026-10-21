import { api } from './bridge'

function applyAppearance(state: unknown) {
  const mode = typeof state === 'string' ? state : state && typeof state === 'object' && 'resolved' in state ? state.resolved : undefined
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.colorMode = mode
}

void api.appearance.getState().then(applyAppearance).catch(() => undefined)
api.appearance.onChanged(applyAppearance)
// The current UI is authored in Simplified Chinese. Recognition language is independent.
document.documentElement.lang = 'zh-CN'
