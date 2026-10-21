import { z } from 'zod'

export function endpointUrl(base: string, suffix: string): URL {
  const url = new URL(base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('服务地址必须使用 HTTP 或 HTTPS')
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
    if (signal?.aborted) throw new Error('请求已取消')
    if (timeout.aborted) throw new Error('服务商请求超时，请检查地址和网络后重试')
    if (error instanceof ProviderError) throw error
    throw new Error('服务商连接失败，请检查服务地址、网络和响应格式')
  }
}

export class ProviderError extends Error {}

export async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel()
    throw new ProviderError(`服务商请求失败 (HTTP ${response.status})，请检查密钥、模型和服务地址`)
  }
  try { return await response.json() }
  catch { throw new ProviderError('服务商返回了无效的 JSON 响应') }
}

export function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new ProviderError('服务商响应格式不符合所选协议，请检查协议和服务地址')
  return result.data
}

export function outputText(value: string): string {
  const text = value.trim()
  if (!text) throw new ProviderError('服务商返回了空结果，请重试或更换模型')
  return text
}

export function bearer(key: string): Record<string, string> {
  return key ? { Authorization: `Bearer ${key}` } : {}
}
