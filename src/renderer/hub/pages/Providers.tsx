import { useCallback, useEffect, useRef, useState } from 'react'
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined'
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined'
import { PROVIDER_PRESETS, createProviderProfile } from '../../../shared/providerPresets'
import {
  EMPTY_SERVICE_PROVIDERS, providerProfileSchema, providerConfigurationIssue, protocolLabels, refinementProtocols,
  transcriptionProtocols, type ProviderProfile, type ProviderService, type ServiceProviders
} from '../../../shared/providers'
import { api, bridge } from '../../shared/utils/bridge'
import { providerApi } from '../../shared/utils/providerApi'
import { Modal } from '../../shared/components/Modal'
import { ConfirmDialog } from '../../shared/components/ConfirmDialog'
import { toast } from '../../shared/components/Toast'
import { Icon } from '../../shared/components/Icons'
import { HubSelect } from '../components/HubSelect'
import '../../shared/styles/providers.css'

const services: ProviderService[] = ['transcription', 'refinement']
const serviceLabels = { transcription: '语音转写', refinement: '文本润色' }
type Draft = Omit<ProviderProfile, 'protocol'> & { protocol: string }
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)
const presetFor = (profile: Pick<ProviderProfile, 'presetId'>) => PROVIDER_PRESETS.find(preset => preset.id === profile.presetId)
const canDiscover = (protocol: string) => ['openai-chat', 'openai-responses', 'anthropic', 'gemini', 'ollama'].includes(protocol)

function blankProfile(service: ProviderService): Draft {
  return { id: `custom-${crypto.randomUUID()}`, presetId: 'custom', name: '自定义服务商', service,
    protocol: service === 'transcription' ? 'openai-transcription' : 'openai-chat', enabled: false,
    endpoint: '', apiKey: '', models: [], appId: '', accessToken: '', resourceId: 'volc.bigasr.sauc.duration', apiVersion: '2024-10-21' }
}

function requestPreview(draft: Draft, model = draft.models[0] || '{model}'): string {
  const base = draft.endpoint.trim()
  if (!base || draft.protocol === 'local-whisper') return ''
  try {
    const url = new URL(base)
    const path = url.pathname.replace(/\/+$/, '')
    const realtimePaths: Record<string, string> = {
      'qwen-asr': '/api-ws/v1/realtime', 'openai-realtime': '/v1/realtime',
      soniox: '/transcribe-websocket', 'volcengine-asr': '/api/v3/sauc/bigmodel_nostream'
    }
    if (realtimePaths[draft.protocol] || draft.protocol === 'elevenlabs' && model.includes('realtime')) {
      url.protocol = ['https:', 'wss:'].includes(url.protocol) ? 'wss:' : 'ws:'
      if (!path) url.pathname = realtimePaths[draft.protocol] || '/v1/speech-to-text/realtime'
      if (draft.protocol === 'openai-realtime') url.searchParams.set('intent', 'transcription')
      if (draft.protocol === 'qwen-asr') {
        const flash = /^(?:fun-asr-flash|qwen-audio-[\d.]+-asr-flash)/.test(model) && !model.includes('realtime')
        if (flash) {
          url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
          if (/^\/api-ws\/v1\/(realtime|inference)\/?$/.test(url.pathname)) url.pathname = '/api/v1/services/aigc/multimodal-generation/generation'
          url.searchParams.delete('model')
        } else {
          const fun = model.startsWith('fun-asr')
          if (/^\/api-ws\/v1\/(realtime|inference)\/?$/.test(url.pathname)) url.pathname = `/api-ws/v1/${fun ? 'inference' : 'realtime'}`
          if (!fun) url.searchParams.set('model', model === 'qwen3-asr-flash' ? 'qwen3-asr-flash-realtime' : model)
        }
      }
      if (draft.protocol === 'volcengine-asr' && /\/api\/v3\/(?:plan\/)?sauc\/bigmodel(?:_nostream|_async)?\/?$/.test(url.pathname)) url.pathname = url.pathname.replace(/bigmodel(?:_nostream|_async)?\/?$/, model)
      if (draft.protocol === 'elevenlabs') {
        url.searchParams.set('model_id', model); url.searchParams.set('audio_format', 'pcm_16000'); url.searchParams.set('commit_strategy', 'manual')
      }
      return url.toString()
    }
    if (draft.protocol === 'elevenlabs') {
      if (url.protocol === 'wss:') url.protocol = 'https:'
      else if (url.protocol === 'ws:') url.protocol = 'http:'
      url.pathname = url.pathname.replace(/\/speech-to-text\/realtime\/?$/, '/speech-to-text')
      for (const parameter of ['model_id', 'audio_format', 'commit_strategy', 'no_verbatim']) url.searchParams.delete(parameter)
    }
    const suffixes: Record<string, string> = {
      'stepfun-asr': '/audio/asr/sse', 'openai-transcription': '/audio/transcriptions',
      'openai-responses': '/responses', anthropic: '/messages', elevenlabs: '/speech-to-text',
      gemini: `/models/${encodeURIComponent(model)}:generateContent`,
      ollama: path.endsWith('/api') ? '/chat' : '/api/chat',
      'azure-openai': path.includes('/deployments/') ? '/chat/completions' : `${path.endsWith('/openai') ? '' : '/openai'}/deployments/${encodeURIComponent(model)}/chat/completions`,
      'openai-chat': '/chat/completions', 'audio-chat': '/chat/completions', 'mimo-asr': '/chat/completions'
    }
    const requestPath = url.pathname.replace(/\/+$/, '')
    const complete = /\/(?:chat\/completions|responses|messages|audio\/transcriptions|audio\/asr(?:\/sse)?|speech-to-text|models|tags|chat|generateContent)$/.test(requestPath) || /:generateContent$/.test(requestPath)
    url.pathname = complete ? requestPath : requestPath + (suffixes[draft.protocol] || '')
    if (draft.protocol === 'gemini' && !path) url.pathname = `/v1beta/models/${encodeURIComponent(model)}:generateContent`
    if (draft.protocol === 'azure-openai') url.searchParams.set('api-version', draft.apiVersion || url.searchParams.get('api-version') || '2024-10-21')
    return url.toString()
  } catch { return base }
}

export function ProvidersPage() {
  const [state, setState] = useState<ServiceProviders>(EMPTY_SERVICE_PROVIDERS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [activeService, setActiveService] = useState<ProviderService>('transcription')
  const loadVersion = useRef(0)
  const reload = useCallback(async () => {
    const version = ++loadVersion.current
    try {
      const result = await providerApi.get()
      if (version === loadVersion.current) { setState(result); setError('') }
    } catch (error) { if (version === loadVersion.current) setError(messageOf(error)) }
    finally { if (version === loadVersion.current) setLoading(false) }
  }, [])
  useEffect(() => { void reload(); const off = bridge.on('store:changed', () => { void reload() }); return () => { ++loadVersion.current; off?.() } }, [reload])
  const apply = (next: ServiceProviders) => { ++loadVersion.current; setState(next); setError('') }
  return <div className="page providers-page">
    <header className="page-heading"><h1 className="page-title">服务商</h1></header>
    {error && <div className="providers-page-error" role="alert"><span>{error}</span><button className="text-button" onClick={() => void reload()}>重新加载</button></div>}
    {loading ? <div className="hub-loading" role="status" aria-label="正在加载服务商" /> : <>
      <div className="segmented-tabs providers-tabs" role="tablist" aria-label="服务类型">{services.map(service => <button type="button" key={service} id={`provider-tab-${service}`} role="tab" aria-selected={activeService === service} aria-controls={`provider-panel-${service}`} tabIndex={activeService === service ? 0 : -1} onClick={() => setActiveService(service)} onKeyDown={event => {
        const next = event.key === 'Home' ? services[0] : event.key === 'End' ? services[services.length - 1] : event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? services.find(value => value !== service) : undefined
        if (next) { event.preventDefault(); setActiveService(next); document.getElementById(`provider-tab-${next}`)?.focus() }
      }}>{serviceLabels[service]}</button>)}</div>
      <div className="providers-groups">{services.map(service => {
        const presets = PROVIDER_PRESETS.filter(preset => preset.service === service)
        const presetIds = new Set(presets.map(preset => preset.id))
        const custom = state.profiles.filter(profile => profile.service === service && !presetIds.has(profile.id))
        return <section key={service} id={`provider-panel-${service}`} className="providers-group" role="tabpanel" aria-labelledby={`provider-tab-${service}`} hidden={activeService !== service}>
          <div className="providers-group-heading"><h2>{serviceLabels[service]}服务商</h2><button type="button" className="secondary-button providers-add-button" onClick={() => setDraft(blankProfile(service))}><Icon name="plus" />添加</button></div>
          <div className="providers-cards">{[...presets.map(preset => ({ profile: state.profiles.find(profile => profile.id === preset.id) ?? createProviderProfile(preset), saved: state.profiles.some(profile => profile.id === preset.id) })), ...custom.map(profile => ({ profile, saved: true }))].map(({ profile, saved }) => {
            const preset = presetFor(profile)
            const selected = state[service]?.providerId === profile.id
            const configured = saved && !providerConfigurationIssue(profile)
            const enabled = saved && profile.enabled
            return <button type="button" className={`provider-card ${selected ? 'is-current' : ''}`} key={profile.id} data-provider-id={profile.id} onClick={() => setDraft({ ...profile, models: [...profile.models] })}>
              <span className="provider-card-main">{preset?.logo ? <img className="provider-logo" src={preset.logo} alt="" /> : <span className="provider-avatar">{profile.name.slice(0, 1).toUpperCase()}</span>}<span className="provider-card-name">{profile.name}</span><span className={`provider-status ${enabled ? 'is-ready' : ''}`} role="img" aria-label={enabled ? '已启用' : saved ? '已停用' : '未配置'} title={enabled ? '已启用' : saved ? '已停用' : '未配置'} /></span>
              <span className="provider-card-bottom"><span>{selected ? `正在使用 · ${state[service]?.model}` : configured ? '已配置' : saved && !profile.enabled ? '已停用' : '点击配置'}</span><span aria-hidden="true">›</span></span>
            </button>
          })}</div>
        </section>
      })}</div>
    </>}
    {draft && <ProviderEditor key={draft.id} initial={draft} saved={state.profiles.some(profile => profile.id === draft.id)} selection={state[draft.service]} onClose={() => setDraft(null)} onUpdated={apply} />}
  </div>
}

function ProviderEditor({ initial, saved, selection, onClose, onUpdated }: {
  initial: Draft; saved: boolean; selection: ServiceProviders['transcription']; onClose: () => void; onUpdated: (state: ServiceProviders) => void
}) {
  const [draft, setDraft] = useState(initial)
  const [baseline, setBaseline] = useState(initial)
  const [modelInput, setModelInput] = useState('')
  const [showSecrets, setShowSecrets] = useState(false)
  const [busy, setBusy] = useState<'save' | 'models' | 'remove' | 'enabled' | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const locked = busy === 'save' || busy === 'remove' || busy === 'enabled'
  const [discard, setDiscard] = useState(false)
  const [removeConfirm, setRemoveConfirm] = useState(false)
  const initialVolcMode = initial.apiKey || !initial.appId ? 'api-key' : 'legacy'
  const [volcMode, setVolcMode] = useState(initialVolcMode)
  const version = useRef(0)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++version.current } }, [])
  const preset = presetFor(draft)
  const providerName = preset ? preset.name.replace(/^小米 MiMo/, 'MIMO') : draft.name
  const editableProtocol = !preset || draft.id !== preset.id || ['asr-openai', 'asr-audio-chat', 'llm-openai_compatible'].includes(preset.id)
  const baselineVolcMode = baseline.apiKey || !baseline.appId ? 'api-key' : 'legacy'
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline) || !!modelInput.trim() || draft.protocol === 'volcengine-asr' && volcMode !== baselineVolcMode
  const effectiveDraft = draft.protocol === 'volcengine-asr' ? volcMode === 'legacy' ? { ...draft, apiKey: '' } : { ...draft, appId: '', accessToken: '' } : draft
  const edit = (patch: Partial<Draft>) => {
    ++version.current
    setDraft(current => {
      const next = { ...current, ...patch }
      if (next.preferredModel && !next.models.includes(next.preferredModel)) delete next.preferredModel
      return next
    })
    setTesting(null); setDiscard(false); setRemoveConfirm(false)
  }
  const close = () => { if (locked) return; if (dirty) setDiscard(true); else onClose() }
  const validate = (requireModel = true): ProviderProfile | null => {
    const parsed = providerProfileSchema.safeParse({ ...effectiveDraft, preferredModel: selectedModel })
    if (!parsed.success) { toast.error(parsed.error.issues.map(issue => issue.message).join('；')); return null }
    if (requireModel && !parsed.data.models.length) { toast.error('请至少添加一个模型'); return null }
    return parsed.data
  }
  const save = async () => {
    const profile = validate()
    if (!profile) return
    const activateModel = selectedModel && !providerConfigurationIssue(profile) ? selectedModel : undefined
    setBusy('save')
    try {
      const next = await providerApi.save(profile, activateModel)
      if (!alive.current) return
      onUpdated(next)
      toast.success('保存成功')
      onClose()
    } catch (error) { if (alive.current) toast.error(messageOf(error)) }
    finally { if (alive.current) { setBusy(null); setTesting(null) } }
  }
  const toggleEnabled = async () => {
    if (busy) return
    const enabled = !draft.enabled
    if (!saved) { edit({ enabled }); return }
    const profile = providerProfileSchema.parse({ ...baseline, enabled })
    setBusy('enabled')
    try {
      const next = await providerApi.save(profile)
      if (!alive.current) return
      onUpdated(next)
      setBaseline(current => ({ ...current, enabled }))
      edit({ enabled })
    } catch (error) { if (alive.current) toast.error(messageOf(error)) }
    finally { if (alive.current) setBusy(null) }
  }
  const test = async (model: string) => {
    const profile = validate()
    if (!profile) return
    const issue = providerConfigurationIssue(profile)
    if (issue) { toast.error(issue); return }
    const requestVersion = ++version.current
    setTesting(model)
    try {
      const result = await providerApi.test(profile, model)
      if (alive.current && requestVersion === version.current) {
        if (result.ok) toast.success('验证通过')
        else toast.error(result.message)
      }
    } catch (error) {
      if (alive.current && requestVersion === version.current) {
        toast.error(messageOf(error))
      }
    } finally { if (alive.current && requestVersion === version.current) setTesting(null) }
  }
  const discover = async () => {
    const profile = validate(false)
    if (!profile) return
    const issue = providerConfigurationIssue(profile, false)
    if (issue) { toast.error(issue); return }
    const requestVersion = ++version.current
    setBusy('models')
    try {
      const models = await providerApi.models(profile)
      if (alive.current && requestVersion === version.current) {
        const next = [...new Set([...draft.models, ...models])]
        edit({ models: next.slice(0, 200) })
        if (models.length) toast.success(next.length > 200 ? '模型列表已获取，仅保留前 200 个' : '模型列表已获取')
        else toast.info('服务未返回可用模型')
      }
    } catch (error) { if (alive.current && requestVersion === version.current) { toast.error(messageOf(error)) } }
    finally { if (alive.current) setBusy(null) }
  }
  const addModel = () => {
    const model = modelInput.trim()
    if (!model || model.length > 200) { toast.error('请输入 1–200 个字符的模型 ID'); return }
    if (draft.models.includes(model)) { toast.error('该模型 ID 已存在'); return }
    if (draft.models.length >= 200) { toast.error('最多添加 200 个模型'); return }
    edit({ models: [...draft.models, model] }); setModelInput('')
  }
  const remove = async () => {
    setBusy('remove')
    try { onUpdated(await providerApi.remove(draft.id)); toast.success('删除成功'); onClose() }
    catch (error) { toast.error(messageOf(error)) }
    finally { if (alive.current) setBusy(null) }
  }
  const protocols = draft.service === 'transcription' ? transcriptionProtocols : refinementProtocols
  const local = draft.protocol === 'local-whisper'
  const readyDraft = providerProfileSchema.safeParse(effectiveDraft)
  const issue = readyDraft.success ? providerConfigurationIssue(readyDraft.data) : '请先填写有效的服务地址和模型'
  const selectedModel = draft.preferredModel ?? (selection?.providerId === draft.id && draft.models.includes(selection.model) ? selection.model : draft.models[0])
  const preview = requestPreview(draft, selectedModel)
  const secretField = (label: string, field: 'apiKey' | 'accessToken') => <div className="provider-field">
    <div className="provider-field-heading"><label htmlFor={`provider-${draft.id}-${field}`}>{label}</label>{preset?.helpUrl && <button type="button" className="provider-inline-link" onClick={() => void api.page.openUrl(preset.helpUrl)}>获取 API Key ↗</button>}</div>
    <div className="provider-secret"><input id={`provider-${draft.id}-${field}`} className="text-input" name={field} type={showSecrets ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={draft[field]} onChange={event => edit({ [field]: event.target.value })} /><button type="button" className="provider-reveal" aria-label={showSecrets ? '隐藏密钥' : '显示密钥'} aria-pressed={showSecrets} title={showSecrets ? '隐藏密钥' : '显示密钥'} onClick={() => setShowSecrets(value => !value)}>{showSecrets ? <VisibilityOffOutlined fontSize="inherit" /> : <VisibilityOutlined fontSize="inherit" />}</button></div>
    {!preset?.helpUrl && <span className="provider-help">无需认证的本地服务可留空</span>}
  </div>
  return <div className="provider-dialog"><Modal title={!saved && initial.id.startsWith('custom-') ? '添加服务商' : '配置服务商'} onClose={close}>
    <form onSubmit={event => { event.preventDefault(); void save() }}>
      <div className="provider-editor-heading">{preset?.logo ? <img className="provider-logo" src={preset.logo} alt="" /> : <span className="provider-avatar">{draft.name.slice(0, 1)}</span>}<div className="provider-editor-identity"><span className="provider-editor-name">{providerName}</span>{preview && <p className="provider-request-preview" aria-label="完整请求地址"><code title={preview}>{preview}</code></p>}</div><label className="provider-enabled"><span>{draft.enabled ? '已启用' : '已停用'}</span><button type="button" role="switch" aria-label="启用服务商" aria-checked={draft.enabled} disabled={locked} className={`provider-switch ${draft.enabled ? 'is-on' : ''}`} aria-busy={busy === 'enabled'} onClick={() => void toggleEnabled()}><span /></button></label></div>
      <fieldset disabled={locked} className="provider-editor-fields">
        <div className={editableProtocol ? 'provider-field-pair' : undefined}><label className="provider-field"><span>名称</span><input className="text-input" name="name" value={draft.name} maxLength={80} onChange={event => edit({ name: event.target.value })} /></label>{editableProtocol && <div className="provider-field"><span>请求协议</span><HubSelect label="请求协议" value={draft.protocol} options={protocols.map(protocol => ({ value: protocol, label: protocolLabels[protocol] }))} onChange={value => edit({ protocol: value })} /></div>}</div>
        {!local && <>
          {draft.protocol === 'volcengine-asr' && <div className="provider-field"><span>认证方式</span><HubSelect label="认证方式" value={volcMode} options={[{ value: 'api-key', label: 'API Key' }, { value: 'legacy', label: 'App ID + Access Token' }]} onChange={value => { setVolcMode(value); edit({}) }} /></div>}
          {draft.protocol === 'volcengine-asr' && volcMode === 'legacy' ? <><label className="provider-field"><span>App ID</span><input className="text-input" name="appId" value={draft.appId} onChange={event => edit({ appId: event.target.value })} /></label>{secretField('Access Token', 'accessToken')}</> : secretField('API Key / Access Token', 'apiKey')}
          {draft.protocol === 'volcengine-asr' && <label className="provider-field"><span>资源 ID</span><input className="text-input" name="resourceId" value={draft.resourceId} onChange={event => edit({ resourceId: event.target.value })} /></label>}
        </>}
        <label className="provider-field"><span>{local ? 'whisper-cli 可执行文件' : '服务地址 · API Base URL'}</span><input className="text-input" name="endpoint" value={draft.endpoint} placeholder={local ? '/usr/local/bin/whisper-cli' : 'https://api.example.com/v1'} autoComplete="off" spellCheck={false} onChange={event => edit({ endpoint: event.target.value })} /></label>
        {draft.protocol === 'azure-openai' && <label className="provider-field"><span>API 版本</span><input className="text-input" name="apiVersion" value={draft.apiVersion} onChange={event => edit({ apiVersion: event.target.value })} /></label>}
        <section className="provider-model-section" aria-label="模型列表"><div className="provider-model-heading"><h3>{local ? '本地模型文件路径' : draft.protocol === 'azure-openai' ? '模型部署名称' : '模型'}</h3><div className="provider-model-heading-actions">{canDiscover(draft.protocol) && <button type="button" className="text-button" disabled={!!busy || !!testing} onClick={() => void discover()}>{busy === 'models' ? '正在获取…' : '获取模型列表'}</button>}{preset?.docsUrl && <button type="button" className="provider-inline-link" onClick={() => void api.page.openUrl(preset.docsUrl)}>查看模型文档 ↗</button>}</div></div>
          <div className="provider-model-list" role="radiogroup" aria-label="当前模型">{draft.models.map(model => {
            const current = selectedModel === model
            return <div className={`provider-model ${current ? 'is-current' : ''}`} key={model}>
              <button type="button" className="provider-model-select" role="radio" aria-checked={current} tabIndex={selectedModel === model ? 0 : -1} aria-label={`选择模型 ${model}`} disabled={!!busy || !!testing} onClick={() => { if (!current) edit({ preferredModel: model }) }} onKeyDown={event => {
                if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const controls = Array.from(event.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])
                const index = controls.indexOf(event.currentTarget)
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (index + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? controls.length - 1 : 1)) % controls.length
                controls[next]?.focus(); controls[next]?.click()
              }}><span className="provider-model-indicator" aria-hidden="true" /><span className="provider-model-name">{model}</span></button>
              <button type="button" className="icon-button provider-model-remove" aria-label={`移除模型 ${model}`} disabled={!!busy || !!testing} onClick={() => edit({ models: draft.models.filter(value => value !== model) })}><Icon name="close" size={14} /></button>
            </div>
          })}{!draft.models.length && <p className="provider-model-empty">添加模型 ID 后，点击模型即可选用。</p>}</div>
          <div className="provider-add-model"><input className="text-input" name="model" aria-label={local ? '模型文件路径' : '模型 ID'} value={modelInput} placeholder={local ? '/path/to/ggml-model.bin' : '输入模型 ID'} onChange={event => { ++version.current; setTesting(null); setModelInput(event.target.value); setDiscard(false) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addModel() } }} /><button type="button" className="secondary-button" onClick={addModel}>添加模型</button></div>
        </section>
      </fieldset>
      <footer className="provider-editor-footer"><div className="provider-footer-leading">{!local && <button type="button" className="secondary-button provider-test-connection" title={issue ?? undefined} disabled={!!testing || !!busy} onClick={() => void test(selectedModel)}>{testing ? '正在验证…' : '验证连接'}</button>}{saved && <button type="button" className="text-button provider-danger" disabled={!!busy} onClick={() => { setDiscard(false); setRemoveConfirm(true) }}>{draft.id === draft.presetId ? '移除配置' : '删除服务商'}</button>}</div><div className="provider-footer-actions"><button type="button" className="secondary-button" disabled={locked} onClick={close}>取消</button><button type="submit" className="primary-button" disabled={!!busy}>{busy === 'save' ? '正在保存…' : '保存配置'}</button></div></footer>
    </form>
  </Modal>{discard && <ConfirmDialog title="放弃尚未保存的修改？" description="有尚未保存的修改，放弃后将无法恢复。" onClose={() => setDiscard(false)} onConfirm={onClose} />}{removeConfirm && <ConfirmDialog title={draft.id === draft.presetId ? '移除此服务商配置？' : '删除此服务商？'} description="此服务商的已保存配置及密钥将被移除，默认模型会同步取消。" subject={draft.name} pending={busy === 'remove'} onClose={() => setRemoveConfirm(false)} onConfirm={() => void remove()} />}</div>
}
