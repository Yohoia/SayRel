import assert from 'node:assert/strict'
import { z } from 'zod'
import { completeChat, listProviderModels } from '../../../src/main/services/providers/chat'
import { ProviderError } from '../../../src/main/services/providers/transport'
import { providerProfileSchema, type ProviderProfile } from '../../../src/shared/providers'
import { createProviders } from '../../../src/main/services/providers'
import { runVoiceAction } from '../../../src/main/services/voiceActions'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings'

const messages = [{ role: 'user', content: 'Clean this text' }] satisfies Parameters<typeof completeChat>[2]
const originalFetch = globalThis.fetch
const requests: { url: URL; init?: RequestInit }[] = []
let response: unknown
let checks = 0
globalThis.fetch = async (input, init) => {
  requests.push({ url: new URL(input instanceof Request ? input.url : input.toString()), init })
  return Response.json(response)
}

function profile(protocol: ProviderProfile['protocol'], endpoint = 'https://provider.example/v1'): Extract<ProviderProfile, { service: 'refinement' }> {
  const parsed = providerProfileSchema.parse({
    id: 'integrity-probe', presetId: '', name: 'Offline probe', service: 'refinement', protocol,
    enabled: true, endpoint, apiKey: 'offline-placeholder', models: ['old-model'],
    appId: '', accessToken: '', resourceId: '', apiVersion: ''
  })
  assert(parsed.service === 'refinement')
  return parsed
}

async function accepts(protocol: ProviderProfile['protocol'], reply: unknown, expected = 'complete text'): Promise<void> {
  response = reply
  assert.equal(await completeChat(profile(protocol), 'selected-model', messages), expected)
  checks++
}

async function rejects(protocol: ProviderProfile['protocol'], reply: unknown): Promise<void> {
  response = reply
  await assert.rejects(completeChat(profile(protocol), 'selected-model', messages), error => {
    assert(error instanceof ProviderError)
    assert(!error.message.includes('partial text'))
    return true
  })
  checks++
}

function lastRequest(): { url: URL; init?: RequestInit } {
  const last = requests.at(-1)
  assert(last)
  return last
}

try {
  for (const protocol of ['openai-chat', 'azure-openai'] satisfies ProviderProfile['protocol'][]) {
    await accepts(protocol, { choices: [{ finish_reason: 'stop', message: { content: 'complete text' } }] })
    await accepts(protocol, { choices: [{ message: { content: 'complete text' } }] })
    for (const finish_reason of ['length', 'content_filter', 'tool_calls', 'function_call', null, 'unknown']) {
      await rejects(protocol, { choices: [{ finish_reason, message: { content: 'partial text' } }] })
    }
    await rejects(protocol, { choices: [{ finish_reason: 'stop', message: { content: 'partial text', refusal: 'refused' } }] })
    await rejects(protocol, { choices: [{ message: { content: 'partial text', tool_calls: [{ type: 'function' }] } }] })
    await rejects(protocol, { choices: [{ message: { content: 'partial text', function_call: { name: 'tool' } } }] })
    await rejects(protocol, { choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'refused' } }] })
  }

  for (const stop_reason of ['end_turn', 'stop_sequence', undefined]) {
    await accepts('anthropic', { stop_reason, content: [{ type: 'text', text: 'complete text' }] })
  }
  for (const stop_reason of ['max_tokens', 'tool_use', 'pause_turn', 'refusal', null]) {
    await rejects('anthropic', { stop_reason, content: [{ type: 'text', text: 'partial text' }] })
  }
  for (const type of ['tool_use', 'server_tool_use', 'mcp_tool_use', 'web_search_tool_result']) {
    await rejects('anthropic', { stop_reason: 'end_turn', content: [{ type: 'text', text: 'partial text' }, { type }] })
  }

  for (const finishReason of ['STOP', undefined]) {
    await accepts('gemini', { candidates: [{ finishReason, content: { parts: [{ text: 'internal thought', thought: true }, { text: 'complete text' }] } }] })
  }
  for (const finishReason of ['MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER', 'MALFORMED_FUNCTION_CALL', 'UNEXPECTED_TOOL_CALL', null]) {
    await rejects('gemini', { candidates: [{ finishReason, content: { parts: [{ text: 'partial text' }] } }] })
  }
  await rejects('gemini', { promptFeedback: { blockReason: 'SAFETY' } })
  await rejects('gemini', { candidates: [{ finishReason: 'SAFETY' }] })
  for (const tool of ['functionCall', 'functionResponse', 'executableCode', 'codeExecutionResult']) {
    await rejects('gemini', { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'partial text' }, { [tool]: {} }] } }] })
  }

  await accepts('ollama', { done: true, done_reason: 'stop', message: { content: 'complete text' } })
  await accepts('ollama', { message: { content: 'complete text' } })
  await rejects('ollama', { done: false, message: { content: 'partial text' } })
  for (const done_reason of ['length', 'load', null]) {
    await rejects('ollama', { done: true, done_reason, message: { content: 'partial text' } })
  }
  await rejects('ollama', { done: true, done_reason: 'stop', message: { content: 'partial text', tool_calls: [{ function: { name: 'tool' } }] } })

  const output = [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: 'complete text' }] }]
  await accepts('openai-responses', { status: 'completed', output })
  await accepts('openai-responses', { output: [{ type: 'message', content: [{ type: 'output_text', text: 'complete text' }] }] })
  await accepts('openai-responses', { status: 'completed', output_text: 'complete text', output })
  await accepts('openai-responses', { status: 'completed', error: null, incomplete_details: null, output: [{ type: 'reasoning' }, ...output] })
  for (const status of ['incomplete', 'in_progress', 'queued', 'failed', 'cancelled', null]) {
    await rejects('openai-responses', { status, output_text: 'partial text', output })
  }
  await rejects('openai-responses', { status: 'completed', incomplete_details: { reason: 'max_output_tokens' }, output_text: 'partial text' })
  await rejects('openai-responses', { status: 'completed', error: { code: 'server_error' }, output_text: 'partial text' })
  for (const status of ['in_progress', 'incomplete', null]) {
    await rejects('openai-responses', { status: 'completed', output_text: 'partial text', output: [{ ...output[0], status }] })
  }
  await rejects('openai-responses', { status: 'completed', output_text: 'partial text', output: [{ type: 'message', status: 'completed', content: [{ type: 'refusal' }] }] })
  for (const type of ['function_call', 'web_search_call', 'computer_call', 'custom_tool_call']) {
    await rejects('openai-responses', { status: 'completed', output_text: 'partial text', output: [{ type, status: 'completed' }, ...output] })
  }
  await rejects('openai-responses', { status: 'completed', output_text: 'partial text', output: [{ type: 'message', content: [{ type: 'unknown' }] }] })

  const model = 'new model/$&segment'
  const encodedModel = encodeURIComponent(model)
  for (const path of ['/proxy%20prefix/v1beta/models/old%20model:generateContent', '/proxy%20prefix/v1beta/models/old%20model:generateContent/', '/proxy%20prefix/v1beta/models', '/proxy%20prefix/v1beta']) {
    response = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'complete text' }] } }] }
    const selected = profile('gemini', `https://provider.example${path}?route=keep%2Fthis&key=unchanged`)
    assert.equal(await completeChat(selected, model, messages), 'complete text')
    assert.equal(lastRequest().url.pathname, `/proxy%20prefix/v1beta/models/${encodedModel}:generateContent`)
    assert.equal(lastRequest().url.search, '?route=keep%2Fthis&key=unchanged')
    response = { models: [{ name: 'models/new-model', supportedGenerationMethods: ['generateContent'] }] }
    assert.deepEqual(await listProviderModels(selected), ['new-model'])
    assert.equal(lastRequest().url.pathname, '/proxy%20prefix/v1beta/models')
    assert.equal(lastRequest().url.search, '?route=keep%2Fthis&key=unchanged')
    checks++
  }
  response = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'complete text' }] } }] }
  await completeChat(profile('gemini', 'https://provider.example/'), model, messages)
  assert.equal(lastRequest().url.pathname, `/v1beta/models/${encodedModel}:generateContent`)
  checks++

  for (const path of ['/proxy%20prefix/openai/deployments/old%20deployment/chat/completions', '/proxy%20prefix/openai/deployments/old%20deployment/chat/completions/', '/proxy%20prefix/openai/deployments/old%20deployment', '/proxy%20prefix/openai', '/proxy%20prefix/openai/chat/completions']) {
    response = { choices: [{ finish_reason: 'stop', message: { content: 'complete text' } }] }
    const selected = profile('azure-openai', `https://provider.example${path}?route=keep%2Fthis&space=one%20two&literal=~&api-version=2025-04-01-preview`)
    assert.equal(await completeChat(selected, model, messages), 'complete text')
    assert.equal(lastRequest().url.pathname, `/proxy%20prefix/openai/deployments/${encodedModel}/chat/completions`)
    assert.equal(lastRequest().url.searchParams.get('route'), 'keep/this')
    assert.equal(lastRequest().url.search, '?route=keep%2Fthis&space=one%20two&literal=~&api-version=2025-04-01-preview')
    assert.equal(lastRequest().url.searchParams.get('api-version'), '2025-04-01-preview')
    const requestCount = requests.length
    assert.deepEqual(await listProviderModels(selected), ['old-model'])
    assert.equal(requests.length, requestCount)
    checks++
  }
  response = { choices: [{ finish_reason: 'stop', message: { content: 'complete text' } }] }
  await completeChat({ ...profile('azure-openai', 'https://provider.example/?api-version=old'), apiVersion: '2024-10-21' }, model, messages)
  assert.equal(lastRequest().url.pathname, `/openai/deployments/${encodedModel}/chat/completions`)
  assert.equal(lastRequest().url.searchParams.get('api-version'), '2024-10-21')
  checks++

  const officialDeepSeek = { ...profile('openai-chat', 'https://api.deepseek.com/v1'), models: ['deepseek-flash', 'deepseek-v4-pro'] }
  const requestBody = () => z.record(z.string(), z.unknown()).parse(JSON.parse(String(lastRequest().init?.body)))
  const defaultReasoning = (reason: string) => {
    assert(!('thinking' in requestBody()), reason)
    assert(!('reasoning_effort' in requestBody()), reason)
  }
  response = { choices: [{ finish_reason: 'stop', message: { content: 'complete text' } }] }
  for (const selectedModel of ['deepseek-flash', 'deepseek-v4-pro']) {
    await completeChat(officialDeepSeek, selectedModel, messages, undefined, 'dictation')
    assert.deepEqual(requestBody().thinking, { type: 'enabled' }, `${selectedModel}: dictation retains reasoning for spelling corrections`)
    assert.equal(requestBody().reasoning_effort, 'low', `${selectedModel}: dictation uses the quality-checked lower reasoning budget`)
    assert.equal(requestBody().model, selectedModel)
  }
  checks++

  await completeChat(officialDeepSeek, 'deepseek-flash', messages)
  defaultReasoning('ordinary model calls preserve the provider default')
  await completeChat(officialDeepSeek, 'deepseek-flash', messages, undefined, 'general')
  defaultReasoning('explicit general calls preserve the provider default')
  checks++

  for (const thinkingMode of ['enabled', 'disabled'] as const) {
    for (const selectedModel of officialDeepSeek.models) {
      for (const purpose of ['dictation', 'general'] as const) {
        await completeChat({ ...officialDeepSeek, thinkingMode }, selectedModel, messages, undefined, purpose)
        assert.deepEqual(requestBody().thinking, { type: thinkingMode }, `${selectedModel}/${purpose}: manual thinking choice reaches the request`)
        assert(!('reasoning_effort' in requestBody()), `${thinkingMode}: explicit mode must not inherit the automatic low reasoning override`)
        checks++
      }
    }
  }

  for (const [endpoint, selectedModel] of [
    ['https://api.deepseek.com/v1', 'deepseek-chat'], ['https://api.deepseek.com/v1', 'deepseek-reasoner'],
    ['https://api.deepseek.com/v1', 'deepseek-flash-future'], ['https://api.deepseek.com.evil.test/v1', 'deepseek-flash'],
    ['https://proxy.example/api.deepseek.com/v1', 'deepseek-flash'], ['http://api.deepseek.com/v1', 'deepseek-flash'],
    ['https://api.deepseek.com:8443/v1', 'deepseek-flash']
  ]) {
    for (const thinkingMode of ['auto', 'enabled', 'disabled'] as const) {
      await completeChat({ ...profile('openai-chat', endpoint), thinkingMode }, selectedModel, messages, undefined, 'dictation')
      defaultReasoning(`${endpoint} / ${selectedModel}: unsupported targets receive no vendor-specific option`)
      checks++
    }
  }
  for (const protocol of ['openai-responses', 'azure-openai'] satisfies ProviderProfile['protocol'][]) {
    response = protocol === 'openai-responses'
      ? { status: 'completed', output_text: 'complete text' }
      : { choices: [{ finish_reason: 'stop', message: { content: 'complete text' } }] }
    await completeChat({ ...profile(protocol, 'https://api.deepseek.com/v1'), thinkingMode: 'enabled' }, 'deepseek-flash', messages, undefined, 'dictation')
    defaultReasoning(`${protocol}: protocol-specific bodies remain unchanged`)
  }
  checks++

  response = { choices: [{ finish_reason: 'stop', message: { content: 'complete text' } }] }
  const legacy = { transcription: 'mock', refinement: 'mock', baseUrl: null, apiKey: null, model: null, refinementModel: null } satisfies Parameters<typeof createProviders>[0]
  const selection = { profiles: [officialDeepSeek], transcription: null, refinement: { providerId: officialDeepSeek.id, model: 'deepseek-flash' } }
  const providers = createProviders(legacy, selection)
  for (const mode of ['voice_transcript', 'voice_command', 'ask_anything', 'translation'] as const) {
    await providers.refinement.refine({ transcript: 'public diagnostic sentence', mode })
    if (mode === 'voice_transcript') {
      assert.deepEqual(requestBody().thinking, { type: 'enabled' }, 'normal dictation keeps correction reasoning')
      assert.equal(requestBody().reasoning_effort, 'low', 'normal dictation reaches the lower reasoning budget')
    }
    else defaultReasoning(`${mode}: refinement keeps general-purpose reasoning behavior`)
  }
  const config = { ...DEFAULT_SETTINGS, serviceProviders: selection }
  for (const mode of ['ask_anything', 'translation'] as const) {
    await runVoiceAction({ transcript: 'public diagnostic sentence', mode, context: null, config, signal: new AbortController().signal })
    defaultReasoning(`${mode}: voice actions keep general-purpose reasoning behavior`)
  }
  checks++

  for (const thinkingMode of ['enabled', 'disabled'] as const) {
    const manualSelection = { ...selection, profiles: selection.profiles.map(profile => providerProfileSchema.parse({ ...profile, thinkingMode })) }
    const manualProviders = createProviders(legacy, manualSelection)
    for (const mode of ['voice_transcript', 'voice_command', 'ask_anything', 'translation'] as const) {
      await manualProviders.refinement.refine({ transcript: 'public diagnostic sentence', mode })
      assert.deepEqual(requestBody().thinking, { type: thinkingMode }, `${mode}: persisted manual mode reaches the writing pipeline`)
      assert(!('reasoning_effort' in requestBody()))
      checks++
    }
    await runVoiceAction({ transcript: 'public diagnostic sentence', mode: 'ask_anything', context: null, config: { ...DEFAULT_SETTINGS, serviceProviders: manualSelection }, signal: new AbortController().signal })
    assert.deepEqual(requestBody().thinking, { type: thinkingMode }, 'manual choice also reaches voice actions')
    checks++
  }

  await createProviders({ ...legacy, refinement: 'openai-compatible', baseUrl: officialDeepSeek.endpoint, apiKey: officialDeepSeek.apiKey, refinementModel: 'deepseek-flash' })
    .refinement.refine({ transcript: 'public diagnostic sentence', mode: 'voice_transcript' })
  assert.deepEqual(requestBody().thinking, { type: 'enabled' }, 'legacy HTTP refinement keeps correction reasoning')
  assert.equal(requestBody().reasoning_effort, 'low', 'legacy HTTP refinement shares the dictation optimization')
  checks++

  process.stdout.write(`Refinement integrity: ${checks} completion, refusal, tool, endpoint and dictation request checks passed.\n`)
} finally {
  globalThis.fetch = originalFetch
}
