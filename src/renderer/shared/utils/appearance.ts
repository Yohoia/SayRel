import { api } from './bridge'

function applyAppearance(state: unknown) {
  const mode = typeof state === 'string' ? state : state && typeof state === 'object' && 'resolved' in state ? state.resolved : undefined
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.colorMode = mode
}

void api.appearance.getState().then(applyAppearance).catch(() => undefined)
api.appearance.onChanged(applyAppearance)
// English is the initial interface language. Recognition language is independent.
document.documentElement.lang = 'en'
