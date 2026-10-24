import { z } from 'zod'
import type { ProviderProfile } from '../../../shared/providers'
import { azureChatUrl, geminiUrl } from '../../../shared/providerEndpoints'
import { bearer, endpointUrl, outputText, parsed, ProviderError, responseJson, withProviderRequest } from './transport'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
const finishReason = z.string().nullable().optional()
const toolCalls = z.array(z.unknown()).nullable().optional()
const openaiReply = z.object({ choices: z.array(z.object({
  finish_reason: finishReason,
  message: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional(), tool_calls: toolCalls, function_call: z.unknown().optional() })
})).min(1) })
const anthropicReply = z.object({ stop_reason: finishReason, content: z.array(z.object({ type: z.string(), text: z.string().optional() })) })
const geminiReply = z.object({
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z.array(z.object({
    finishReason,
    content: z.object({ parts: z.array(z.object({
      text: z.string().optional(), thought: z.boolean().optional(), functionCall: z.unknown().optional(),
      functionResponse: z.unknown().optional(), executableCode: z.unknown().optional(), codeExecutionResult: z.unknown().optional()
    })) }).optional()
  })).optional()
})
const ollamaReply = z.object({ done: z.boolean().optional(), done_reason: finishReason, message: z.object({ content: z.string(), tool_calls: toolCalls }) })
const responsesReply = z.object({
  status: finishReason,
  error: z.unknown().optional(),
  incomplete_details: z.unknown().optional(),
  output_text: z.string().optional(),
  output: z.array(z.object({
    type: z.string(), status: finishReason,
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional()
  })).optional()
})

function requireFinished(reason: string | null | undefined, completed: string[]): void {
  if (reason !== undefined && !completed.includes(reason ?? '')) rejectIncompleteResult()
}

function rejectIncompleteResult(): never {
  throw new ProviderError('The provider did not finish the result. It may have reached an output limit, been blocked, or requested a tool. Try again or select another model.')
}

function rejectToolResult(): never {
  throw new ProviderError('The provider requested a tool instead of returning a complete text result. Select another model or try again.')
}

function rejectRefusal(): never {
  throw new ProviderError('The provider refused the request. Revise the text or select another model.')
}

export async function completeChat(profile: ProviderProfile, model: string, messages: ChatMessage[], signal?: AbortSignal, purpose: 'general' | 'dictation' = 'general'): Promise<string> {
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
        url = geminiUrl(profile.endpoint, model)
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
        url = azureChatUrl(profile.endpoint, model, profile.apiVersion)
        headers['api-key'] = profile.apiKey
        body = { messages, temperature: 0.2 }
        break
      }
      case 'openai-responses':
        url = endpointUrl(profile.endpoint, '/responses')
        Object.assign(headers, bearer(profile.apiKey))
        body = { model, input: messages, stream: false }
        break
      case 'openai-chat': {
        url = endpointUrl(profile.endpoint, '/chat/completions')
        Object.assign(headers, bearer(profile.apiKey))
        const fastDictation = purpose === 'dictation' && url.protocol === 'https:' && url.hostname === 'api.deepseek.com' && ['deepseek-flash', 'deepseek-v4-pro'].includes(model)
        body = { model, messages, temperature: 0.2, stream: false, ...(fastDictation ? { thinking: { type: 'enabled' }, reasoning_effort: 'low' } : {}) }
        break
      }
      default: { const exhaustive: never = protocol; throw new Error(`Unknown protocol ${exhaustive}`) }
    }
    const data = await responseJson(await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: requestSignal }))
    switch (protocol) {
      case 'anthropic': {
        const reply = parsed(anthropicReply, data)
        requireFinished(reply.stop_reason, ['end_turn', 'stop_sequence'])
        if (reply.content.some(part => !['text', 'thinking', 'redacted_thinking'].includes(part.type))) rejectToolResult()
        return outputText(reply.content.filter(part => part.type === 'text').map(part => part.text ?? '').join(''))
      }
      case 'gemini': {
        const reply = parsed(geminiReply, data)
        if (reply.promptFeedback?.blockReason) rejectRefusal()
        const candidate = reply.candidates?.[0]
        if (!candidate) throw new ProviderError('The provider returned no text candidate. Revise the text or select another model.')
        requireFinished(candidate.finishReason, ['STOP'])
        const parts = candidate.content?.parts ?? []
        if (parts.some(part => part.functionCall != null || part.functionResponse != null || part.executableCode != null || part.codeExecutionResult != null)) rejectToolResult()
        return outputText(parts.filter(part => !part.thought).map(part => part.text ?? '').join(''))
      }
      case 'ollama': {
        const reply = parsed(ollamaReply, data)
        if (reply.done === false) rejectIncompleteResult()
        requireFinished(reply.done_reason, ['stop'])
        if (reply.message.tool_calls?.length) rejectToolResult()
        return outputText(reply.message.content)
      }
      case 'openai-responses': {
        const reply = parsed(responsesReply, data)
        requireFinished(reply.status, ['completed'])
        if (reply.error != null || reply.incomplete_details != null) rejectIncompleteResult()
        for (const item of reply.output ?? []) {
          requireFinished(item.status, ['completed'])
          if (item.type !== 'message' && item.type !== 'reasoning') rejectToolResult()
          if (item.content?.some(part => part.type === 'refusal')) rejectRefusal()
          if (item.type === 'message' && item.content?.some(part => part.type !== 'output_text')) rejectToolResult()
        }
        return outputText(reply.output_text ?? reply.output?.filter(item => item.type === 'message').flatMap(item => item.content ?? []).filter(part => part.type === 'output_text').map(part => part.text ?? '').join('') ?? '')
      }
      case 'openai-chat': case 'azure-openai': {
        const choice = parsed(openaiReply, data).choices[0]
        requireFinished(choice.finish_reason, ['stop'])
        if (choice.message.refusal) rejectRefusal()
        if (choice.message.tool_calls?.length || choice.message.function_call != null) rejectToolResult()
        return outputText(choice.message.content ?? '')
      }
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
      case 'gemini': url = geminiUrl(profile.endpoint); headers['x-goog-api-key'] = profile.apiKey; break
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
