import { context } from '../lib/native'
import { createLogger } from '../lib/logger'
import { settings } from '../lib/settings'
import type {
  AudioContextSnapshot,
  FocusedAppInfo,
  FocusedInputInfo
} from '../../shared/types'

const log = createLogger('context')

/**
 * Gathers the focused-app / focused-input snapshot sent alongside audio.
 * Every field is optional: capture must never block dictation.
 */
export async function captureAudioContext(): Promise<AudioContextSnapshot> {
  const config = settings.get()
  const snapshot: AudioContextSnapshot = {
    focusedApp: null,
    focusedInput: null,
    visibleText: null
  }
  if (!config.sendFocusedAppContext || !context.available) return snapshot

  try {
    const raw = await context.getFocusedAppInfo()
    if (raw) {
      snapshot.focusedApp = {
        appName: raw.appName ?? null,
        bundleId: raw.bundleId ?? null,
        windowTitle: raw.windowTitle ?? null,
        webTitle: raw.webTitle ?? null,
        webDomain: raw.webDomain ?? null,
        webUrl: raw.webUrl ?? null,
        capturedAt: raw.capturedAt ?? Date.now()
      } satisfies FocusedAppInfo
    }
  } catch (err) {
    log.warn('focused app capture failed', err)
  }

  try {
    const raw = await context.getFocusedElementInfo()
    if (raw) {
      const secure = Boolean(raw.isSecure || raw.secureInput || raw.subrole === 'AXSecureTextField')
      snapshot.focusedInput = {
        role: raw.role ?? null,
        valuePreview: secure ? null : raw.valuePreview ?? null,
        selectedText: secure ? null : raw.selectedText ?? null,
        isSecure: secure,
        bounds: raw.bounds ?? null
      } satisfies FocusedInputInfo
    }
  } catch (err) {
    log.warn('focused element capture failed', err)
  }

  if (config.sendScreenContext && !snapshot.focusedInput?.isSecure) {
    try {
      const raw = await context.getFocusedVisibleText()
      snapshot.visibleText = raw?.visibleText ?? null
    } catch (err) {
      log.warn('visible text capture failed', err)
    }
  }

  return snapshot
}
