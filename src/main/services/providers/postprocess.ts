import type { TranscriptionRequest } from '../../../shared/types'

const FILLERS_EN = /\b(?:um|uh|erm|uhh|hmm)\b[,\s]*/gi

/** Applies deterministic cleanup before the text reaches the refiner. */
export function normalizeText(text: string, req?: TranscriptionRequest): string {
  let out = text.replace(/\r\n/g, '\n').trim()
  if (!out) return out

  // Collapse the stutter that ASR models produce on repeated words.
  out = out.replace(/\b(\w+)(?:\s+\1\b){2,}/gi, '$1')
  out = out.replace(/[ \t]{2,}/g, ' ')
  out = out.replace(/\n{3,}/g, '\n\n')

  if (req?.language && req.language.startsWith('en')) {
    out = out.replace(FILLERS_EN, '')
    out = out.charAt(0).toUpperCase() + out.slice(1)
  }
  return out.trim()
}

export function ensureTrailingSpace(text: string, enabled: boolean): string {
  if (!enabled) return text
  if (!text || /\s$/.test(text)) return text
  return `${text} `
}
