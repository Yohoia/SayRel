import { z } from 'zod'
import type { ProviderProfile } from '../../../shared/providers'
import { bearer, endpointUrl, outputText, parsed, responseJson, withProviderRequest } from './transport'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
const openaiReply = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) })
const anthropicReply = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })) })
const geminiReply = z.object({ candidates: z.array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }) })).min(1) })
const ollamaReply = z.object({ message: z.object({ content: z.string() }) })
const responsesReply = z.object({ output_text: z.string().optional(), output: z.array(z.object({ type: z.string(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })).optional() })

export async function completeChat(profile: ProviderProfile, model: string, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  if (profile.service !== 'refinement') throw new Error("Select a language model provider")
  const protocol = profile.protocol
  return withProviderRequest(signal, async requestSignal => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    let url: URL
    let body: unknown
    switch (protocol) {
      case 'anthropic':
        url = endpointUrl(profile.endpoint, '/messages')
        headers['x-api-key'] = profile.apiKey
        headers['anthropic-version'] = '2023-06-01'
        body = { model, max_tokens: 4096, system: messages.filter(m => m.role === 'system').map(m => m.content).join('\n'), messages: messages.filter(m => m.role !== 'system') }
        break
      case 'gemini': {
        const base = new URL(profile.endpoint)
        url = endpointUrl(profile.endpoint, `/models/${encodeURIComponent(model)}:generateContent`)
        if (!base.pathname.includes('/models/') && !base.pathname.replace(/\/$/, '').endsWith('/v1beta') && base.pathname === '/') url.pathname = `/v1beta/models/${encodeURIComponent(model)}:generateContent`
        headers['x-goog-api-key'] = profile.apiKey
        body = { ...(messages.some(m => m.role === 'system') ? { systemInstruction: { parts: messages.filter(m => m.role === 'system').map(m => ({ text: m.content })) } } : {}), contents: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) }
        break
      }
      case 'ollama':
        url = endpointUrl(profile.endpoint, new URL(profile.endpoint).pathname.replace(/\/$/, '').endsWith('/api') ? '/chat' : '/api/chat')
        Object.assign(headers, bearer(profile.apiKey))
        body = { model, messages, stream: false }
        break
      case 'azure-openai': {
        const base = new URL(profile.endpoint)
        url = endpointUrl(profile.endpoint, base.pathname.includes('/deployments/') ? '/chat/completions' : `${base.pathname.replace(/\/$/, '').endsWith('/openai') ? '' : '/openai'}/deployments/${encodeURIComponent(model)}/chat/completions`)
        url.searchParams.set('api-version', profile.apiVersion || url.searchParams.get('api-version') || '2024-10-21')
        headers['api-key'] = profile.apiKey
        body = { messages, temperature: 0.2 }
        break
      }
      case 'openai-responses':
        url = endpointUrl(profile.endpoint, '/responses')
        Object.assign(headers, bearer(profile.apiKey))
        body = { model, input: messages, stream: false }
        break
      case 'openai-chat':
        url = endpointUrl(profile.endpoint, '/chat/completions')
        Object.assign(headers, bearer(profile.apiKey))
        body = { model, messages, temperature: 0.2, stream: false }
        break
      default: { const exhaustive: never = protocol; throw new Error(`Unknown protocol ${exhaustive}`) }
    }
    const data = await responseJson(await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: requestSignal }))
    switch (protocol) {
      case 'anthropic': return outputText(parsed(anthropicReply, data).content.filter(p => p.type === 'text').map(p => p.text ?? '').join(''))
      case 'gemini': return outputText(parsed(geminiReply, data).candidates[0].content.parts.map(p => p.text ?? '').join(''))
      case 'ollama': return outputText(parsed(ollamaReply, data).message.content)
      case 'openai-responses': { const reply = parsed(responsesReply, data); return outputText(reply.output_text ?? reply.output?.flatMap(o => o.content ?? []).filter(c => c.type === 'output_text').map(c => c.text ?? '').join('') ?? '') }
      case 'openai-chat': case 'azure-openai': return outputText(parsed(openaiReply, data).choices[0].message.content)
      default: { const exhaustive: never = protocol; throw new Error(`Unknown protocol ${exhaustive}`) }
    }
  })
}

export async function listProviderModels(profile: ProviderProfile, signal?: AbortSignal): Promise<string[]> {
  if (profile.service === 'transcription' || profile.protocol === 'azure-openai') return [...profile.models]
  const protocol = profile.protocol
  return withProviderRequest(signal, async requestSignal => {
    const headers: Record<string, string> = {}
    let url: URL
    switch (protocol) {
      case 'gemini': url = endpointUrl(profile.endpoint, new URL(profile.endpoint).pathname === '/' ? '/v1beta/models' : '/models'); headers['x-goog-api-key'] = profile.apiKey; break
      case 'anthropic': url = endpointUrl(profile.endpoint, '/models'); headers['x-api-key'] = profile.apiKey; headers['anthropic-version'] = '2023-06-01'; break
      case 'ollama': url = endpointUrl(profile.endpoint, new URL(profile.endpoint).pathname.replace(/\/$/, '').endsWith('/api') ? '/tags' : '/api/tags'); Object.assign(headers, bearer(profile.apiKey)); break
      case 'openai-chat': case 'openai-responses': url = endpointUrl(profile.endpoint, '/models'); Object.assign(headers, bearer(profile.apiKey)); break
      default: { const exhaustive: never = protocol; throw new Error(`Unknown protocol ${exhaustive}`) }
    }
    // Listing always targets the collection, including when a full request URL was entered.
    url.pathname = url.pathname.replace(/\/(chat\/completions|responses|messages)$/, '/models').replace(/\/api\/chat$/, '/api/tags').replace(/\/models\/[^/]+:generateContent$/, '/models')
    const data = await responseJson(await fetch(url, { headers, signal: requestSignal }))
    let models: string[]
    if (profile.protocol === 'ollama') models = parsed(z.object({ models: z.array(z.object({ name: z.string() })) }), data).models.map(m => m.name)
    else if (profile.protocol === 'gemini') models = parsed(z.object({ models: z.array(z.object({ name: z.string(), supportedGenerationMethods: z.array(z.string()).optional() })) }), data).models.filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent')).map(m => m.name.replace(/^models\//, ''))
    else models = parsed(z.object({ data: z.array(z.object({ id: z.string() })) }), data).data.map(m => m.id)
    return [...new Set(models.filter(Boolean))].sort()
  })
}
