import { useEffect, useState } from 'react'
import { api } from '../shared/utils/bridge'

/**
 * Local mirror of the recorder session.
 *
 * The authoritative state machine lives in the main process; this hook only
 * tracks enough to render the pill and to show a first-run hint when no
 * shortcut is configured.
 */
export function useHotkeyState(mode = 'voice_transcript') {
  const [hint, setHint] = useState<string | null>(null)
  const [shortcutLabel, setShortcutLabel] = useState<string>('Fn')

  useEffect(() => {
    let cancelled = false
    const update = (config: any) => {
      if (cancelled) return
      const binding = mode === 'translation' ? config?.translationShortcut
        : mode === 'ask_anything' ? config?.askAnythingShortcut
        : mode === 'voice_command' ? config?.commandShortcut : config?.shortcut
      setShortcutLabel(binding?.enabled ? binding.accelerator : '')
      setHint(config?.onboardingCompleted && config?.shortcut?.enabled === false ? "No shortcut set. Click here to start" : null)
    }
    const off = window.offkey?.on('store:changed', update)
    api.settings
      .get()
      .then(update)
      .catch(() => undefined)
    return () => {
      cancelled = true
      off?.()
    }
  }, [mode])

  return { hint, shortcutLabel }
}
