import type { TranscriptionRequest } from '../../../shared/types'

/** Normalize transport whitespace without deleting or rewriting dictated content. */
export function normalizeText(text: string, _req?: TranscriptionRequest): string {
  return text.replace(/\r\n/g, '\n').trim()
}

export function ensureTrailingSpace(text: string, enabled: boolean): string {
  if (!enabled) return text
  if (!text || /\s$/.test(text)) return text
  return `${text} `
}
