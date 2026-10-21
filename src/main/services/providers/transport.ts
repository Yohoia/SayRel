import { z } from 'zod'

export function endpointUrl(base: string, suffix: string): URL {
  const url = new URL(base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("The API base URL must use HTTP or HTTPS")
  const path = url.pathname.replace(/\/+$/, '')
  // A complete API path is kept as supplied; base URLs receive the route once.
  const known = /\/(?:chat\/completions|responses|messages|audio\/transcriptions|audio\/asr(?:\/sse)?|speech-to-text|models|tags|chat|generateContent)$/
  url.pathname = known.test(path) || /:generateContent$/.test(path) ? path : `${path}${suffix}`
  return url
}

export function elevenlabsRestUrl(base: string): URL {
  const url = new URL(base)
  if (url.protocol === 'wss:') url.protocol = 'https:'
  else if (url.protocol === 'ws:') url.protocol = 'http:'
  url.pathname = url.pathname.replace(/\/speech-to-text\/realtime\/?$/, '/speech-to-text')
  for (const parameter of ['model_id', 'audio_format', 'commit_strategy', 'no_verbatim']) url.searchParams.delete(parameter)
  return endpointUrl(url.toString(), '/speech-to-text')
}

export async function withProviderRequest<T>(signal: AbortSignal | undefined, run: (requestSignal: AbortSignal) => Promise<T>): Promise<T> {
  const timeout = AbortSignal.timeout(60_000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  try { return await run(combined) }
  catch (error) {
    if (signal?.aborted) throw new Error("Request cancelled")
    if (timeout.aborted) throw new Error("The provider request timed out. Check the URL and network.")
    if (error instanceof ProviderError) throw error
    throw new Error("Could not connect to the provider. Check the URL, network, and response format.")
  }
}

export class ProviderError extends Error {}

export async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel()
    throw new ProviderError(`Provider request failed (HTTP ${response.status}). Check credentials, model, and API base URL.`)
  }
  try { return await response.json() }
  catch { throw new ProviderError("The provider returned invalid JSON") }
}

export function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new ProviderError("The response does not match the selected protocol. Check the protocol and API base URL.")
  return result.data
}

export function outputText(value: string): string {
  const text = value.trim()
  if (!text) throw new ProviderError("The provider returned an empty result. Try again or select another model.")
  return text
}

export function bearer(key: string): Record<string, string> {
  return key ? { Authorization: `Bearer ${key}` } : {}
}
