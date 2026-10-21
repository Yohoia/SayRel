import { useCallback, useEffect, useRef, useState } from 'react'
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
type ModelActivity = { model: string; kind: 'testing' | 'selecting' }
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)
const presetFor = (profile: Pick<ProviderProfile, 'presetId'>) => PROVIDER_PRESETS.find(preset => preset.id === profile.presetId)
const canDiscover = (protocol: string) => ['openai-chat', 'openai-responses', 'anthropic', 'gemini', 'ollama'].includes(protocol)

function blankProfile(service: ProviderService): Draft {
  return { id: `custom-${crypto.randomUUID()}`, presetId: 'custom', name: '自定义服务商', service,
    protocol: service === 'transcription' ? 'openai-transcription' : 'openai-chat', enabled: true,
    endpoint: '', apiKey: '', models: [], appId: '', accessToken: '', resourceId: 'volc.bigasr.sauc.duration', apiVersion: '2024-10-21' }
}

function requestPreview(draft: Draft): string {
  const base = draft.endpoint.trim().replace(/\/+$/, '')
  if (!base || draft.protocol === 'local-whisper') return ''
  const model = draft.models[0] || '{model}'
  const suffix = draft.protocol === 'stepfun-asr' ? '/audio/asr/sse'
    : draft.protocol === 'openai-transcription' ? '/audio/transcriptions'
    : draft.protocol === 'openai-responses' ? '/responses'
      : draft.protocol === 'anthropic' ? '/messages'
        : draft.protocol === 'gemini' ? `/models/${encodeURIComponent(model)}:generateContent`
          : draft.protocol === 'ollama' ? (base.endsWith('/api') ? '/chat' : '/api/chat')
            : draft.protocol === 'azure-openai' ? `/openai/deployments/${encodeURIComponent(model)}/chat/completions`
              : ['openai-chat', 'audio-chat', 'mimo-asr'].includes(draft.protocol) ? '/chat/completions' : ''
  try {
    const url = new URL(base), path = url.pathname.replace(/\/+$/, '')
    const complete = /\/(?:chat\/completions|responses|messages|audio\/transcriptions|audio\/asr(?:\/sse)?|speech-to-text|models|tags|chat|generateContent)$/.test(path) || /:generateContent$/.test(path)
    if (suffix && !complete) url.pathname = path + suffix
    if (draft.protocol === 'gemini' && path === '') url.pathname = `/v1beta${suffix}`
    if (draft.protocol === 'azure-openai') {
      if (!complete) url.pathname = path.includes('/deployments/') ? `${path}/chat/completions` : `${path}${path.endsWith('/openai') ? '' : '/openai'}/deployments/${encodeURIComponent(model)}/chat/completions`
      url.searchParams.set('api-version', draft.apiVersion || url.searchParams.get('api-version') || '2024-10-21')
    }
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
    <header className="page-heading"><h1 className="page-title">服务商</h1><span className="providers-private"><Icon name="settings" />由你选择模型</span></header>
    <p className="providers-intro">分别配置语音转写和文本润色，使用你自己的模型服务。</p>
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
          <div className="providers-group-heading"><h2>{serviceLabels[service]}服务商</h2><button className="text-button" onClick={() => setDraft(blankProfile(service))}><Icon name="plus" />添加</button></div>
          <div className="providers-cards">{[...presets.map(preset => ({ profile: state.profiles.find(profile => profile.id === preset.id) ?? createProviderProfile(preset), saved: state.profiles.some(profile => profile.id === preset.id) })), ...custom.map(profile => ({ profile, saved: true }))].map(({ profile, saved }) => {
            const preset = presetFor(profile)
            const selected = state[service]?.providerId === profile.id
            const configured = saved && !providerConfigurationIssue(profile)
            return <button type="button" className={`provider-card ${selected ? 'is-current' : ''}`} key={profile.id} data-provider-id={profile.id} onClick={() => setDraft({ ...profile, models: [...profile.models] })}>
              <span className="provider-card-main">{preset?.logo ? <img className="provider-logo" src={preset.logo} alt="" /> : <span className="provider-avatar">{profile.name.slice(0, 1).toUpperCase()}</span>}<span className="provider-card-name">{profile.name}</span><span className={`provider-status ${configured ? 'is-ready' : ''}`} role="img" aria-label={configured ? '已配置' : saved && !profile.enabled ? '已停用' : '未配置'} title={configured ? '已配置' : saved && !profile.enabled ? '已停用' : '未配置'} /></span>
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
  const [busy, setBusy] = useState<'save' | 'models' | 'remove' | null>(null)
  const [modelActivity, setModelActivity] = useState<ModelActivity | null>(null)
  const testing = modelActivity?.kind === 'testing' ? modelActivity.model : ''
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
  const edit = (patch: Partial<Draft>) => { ++version.current; setDraft(current => ({ ...current, ...patch })); setModelActivity(null); setDiscard(false); setRemoveConfirm(false) }
  const close = () => { if (busy === 'save' || busy === 'remove') return; if (dirty) setDiscard(true); else onClose() }
  const validate = (requireModel = true): ProviderProfile | null => {
    const parsed = providerProfileSchema.safeParse(effectiveDraft)
    if (!parsed.success) { toast.error(parsed.error.issues.map(issue => issue.message).join('；')); return null }
    if (requireModel && !parsed.data.models.length) { toast.error('请至少添加一个模型'); return null }
    return parsed.data
  }
  const save = async (activateModel?: string) => {
    const profile = validate()
    if (!profile) return
    if (activateModel) {
      const issue = providerConfigurationIssue(profile)
      if (issue) { toast.error(issue); return }
      setModelActivity({ model: activateModel, kind: 'selecting' })
    }
    setBusy('save')
    try {
      const next = await providerApi.save(profile, activateModel)
      onUpdated(next)
      toast.success(activateModel ? '设置成功' : '保存成功')
      if (activateModel) {
        setDraft(profile); setBaseline(profile); setDiscard(false); setRemoveConfirm(false)
        setModelActivity(null)
      } else onClose()
    }
    catch (error) { toast.error(messageOf(error)) }
    finally { if (alive.current) { setBusy(null); setModelActivity(null) } }
  }
  const test = async (model: string) => {
    const profile = validate()
    if (!profile) return
    const issue = providerConfigurationIssue(profile)
    if (issue) { toast.error(issue); return }
    const requestVersion = ++version.current
    setModelActivity({ model, kind: 'testing' })
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
    } finally { if (alive.current && requestVersion === version.current) setModelActivity(null) }
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
  const secretField = (label: string, field: 'apiKey' | 'accessToken') => <label className="provider-field"><span>{label}</span><div className="provider-secret"><input className="text-input" name={field} type={showSecrets ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={draft[field]} onChange={event => edit({ [field]: event.target.value })} /><button type="button" className="provider-reveal" aria-label={showSecrets ? '隐藏密钥' : '显示密钥'} aria-pressed={showSecrets} onClick={() => setShowSecrets(value => !value)}>{showSecrets ? '隐藏' : '显示'}</button></div></label>
  return <div className="provider-dialog"><Modal title={!saved && initial.id.startsWith('custom-') ? '添加服务商' : '配置服务商'} onClose={close}>
    <form onSubmit={event => { event.preventDefault(); void save() }}>
      <div className="provider-editor-heading">{preset?.logo ? <img className="provider-logo" src={preset.logo} alt="" /> : <span className="provider-avatar">{draft.name.slice(0, 1)}</span>}<span className="provider-editor-name">{providerName}</span><label className="provider-enabled"><span>{draft.enabled ? '已启用' : '已停用'}</span><button type="button" role="switch" aria-label="启用服务商" aria-checked={draft.enabled} disabled={busy === 'save' || busy === 'remove'} className={`provider-switch ${draft.enabled ? 'is-on' : ''}`} onClick={() => edit({ enabled: !draft.enabled })}><span /></button></label></div>
      <fieldset disabled={busy === 'save' || busy === 'remove'} className="provider-editor-fields">
        {!saved && initial.id.startsWith('custom-') && <div className="provider-field"><span>使用模板</span><HubSelect label="服务商模板" value={draft.presetId} options={[{ value: 'custom', label: '自定义配置' }, ...PROVIDER_PRESETS.filter(preset => preset.service === draft.service).map(preset => ({ value: preset.id, label: preset.name }))]} onChange={value => { const template = PROVIDER_PRESETS.find(preset => preset.id === value); if (template) edit(createProviderProfile(template, initial.id)); else edit({ ...blankProfile(draft.service), id: initial.id }) }} /></div>}
        <div className={editableProtocol ? 'provider-field-pair' : undefined}><label className="provider-field"><span>名称</span><input className="text-input" name="name" value={draft.name} maxLength={80} onChange={event => edit({ name: event.target.value })} /></label>{editableProtocol && <div className="provider-field"><span>请求协议</span><HubSelect label="请求协议" value={draft.protocol} options={protocols.map(protocol => ({ value: protocol, label: protocolLabels[protocol] }))} onChange={value => edit({ protocol: value })} /></div>}</div>
        {!local && <>
          {draft.protocol === 'volcengine-asr' && <div className="provider-field"><span>认证方式</span><HubSelect label="认证方式" value={volcMode} options={[{ value: 'api-key', label: 'API Key' }, { value: 'legacy', label: 'App ID + Access Token' }]} onChange={value => { setVolcMode(value); edit({}) }} /></div>}
          {draft.protocol === 'volcengine-asr' && volcMode === 'legacy' ? <><label className="provider-field"><span>App ID</span><input className="text-input" name="appId" value={draft.appId} onChange={event => edit({ appId: event.target.value })} /></label>{secretField('Access Token', 'accessToken')}</> : secretField('API Key / Access Token', 'apiKey')}
          <div className="provider-credential-actions">{preset?.helpUrl ? <button type="button" className="text-button" onClick={() => void api.page.openUrl(preset.helpUrl)}>获取 API Key ↗</button> : <span className="provider-help">无需认证的本地服务可留空</span>}<button type="button" className="secondary-button" title={issue ?? undefined} disabled={!!testing || !!busy} onClick={() => void test(draft.models[0])}>{testing ? '正在验证…' : '验证连接'}</button></div>
          {draft.protocol === 'volcengine-asr' && <label className="provider-field"><span>资源 ID</span><input className="text-input" name="resourceId" value={draft.resourceId} onChange={event => edit({ resourceId: event.target.value })} /></label>}
        </>}
        <label className="provider-field"><span>{local ? 'whisper-cli 可执行文件' : '服务地址 · API Base URL'}</span><input className="text-input" name="endpoint" value={draft.endpoint} placeholder={local ? '/usr/local/bin/whisper-cli' : 'https://api.example.com/v1'} autoComplete="off" spellCheck={false} onChange={event => edit({ endpoint: event.target.value })} /></label>
        {requestPreview(draft) && <p className="provider-request-preview">请求地址预览 <code>{requestPreview(draft)}</code></p>}
        {draft.protocol === 'azure-openai' && <label className="provider-field"><span>API 版本</span><input className="text-input" name="apiVersion" value={draft.apiVersion} onChange={event => edit({ apiVersion: event.target.value })} /></label>}
        <section className="provider-model-section" aria-label="模型列表"><div className="provider-model-heading"><h3>{local ? '本地模型文件路径' : draft.protocol === 'azure-openai' ? '模型部署名称' : '模型'}</h3>{canDiscover(draft.protocol) && <button type="button" className="text-button" disabled={!!busy || !!testing} onClick={() => void discover()}>{busy === 'models' ? '正在获取…' : '获取模型列表'}</button>}</div>
          {preset?.docsUrl && <button type="button" className="provider-docs" onClick={() => void api.page.openUrl(preset.docsUrl)}>查看模型文档 ↗</button>}
          <div className="provider-model-list">{draft.models.map(model => {
            const current = selection?.providerId === draft.id && selection.model === model
            const activity = modelActivity?.model === model ? modelActivity : null
            return <div className={`provider-model ${current ? 'is-current' : ''}`} key={model}>
              <div className="provider-model-main"><span className="provider-model-name">{model}</span><div className="provider-model-actions">{current && <span className="provider-current"><Icon name="check" size={12} />当前默认</span>}<button type="button" className="text-button" title={issue ?? undefined} disabled={!!busy || !!testing} onClick={() => void test(model)} aria-label={`验证模型 ${model}`}>{testing === model ? '验证中…' : '验证'}</button><button type="button" className="provider-use-button" title={issue ?? undefined} aria-pressed={current} disabled={current || !!busy || !!testing} onClick={() => void save(model)}>{current ? '已设为默认' : activity?.kind === 'selecting' ? '设置中…' : '设为默认'}</button><button type="button" className="icon-button" aria-label={`移除模型 ${model}`} onClick={() => edit({ models: draft.models.filter(value => value !== model) })}><Icon name="close" size={14} /></button></div></div>
            </div>
          })}{!draft.models.length && <p className="provider-model-empty">添加模型 ID 后，即可验证并设为默认。</p>}</div>
          <div className="provider-add-model"><input className="text-input" name="model" aria-label={local ? '模型文件路径' : '模型 ID'} value={modelInput} placeholder={local ? '/path/to/ggml-model.bin' : '输入模型 ID'} onChange={event => { ++version.current; setModelActivity(null); setModelInput(event.target.value); setDiscard(false) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addModel() } }} /><button type="button" className="secondary-button" onClick={addModel}>添加模型</button></div>
        </section>
      </fieldset>
      <footer className="provider-editor-footer">{saved && <button type="button" className="text-button provider-danger" disabled={!!busy} onClick={() => { setDiscard(false); setRemoveConfirm(true) }}>{draft.id === draft.presetId ? '移除配置' : '删除服务商'}</button>}<div><button type="button" className="secondary-button" disabled={busy === 'save' || busy === 'remove'} onClick={close}>取消</button><button type="submit" className="primary-button" disabled={!!busy}>{busy === 'save' ? '正在保存…' : '保存配置'}</button></div></footer>
    </form>
  </Modal>{discard && <ConfirmDialog title="放弃尚未保存的修改？" description="有尚未保存的修改，放弃后将无法恢复。" onClose={() => setDiscard(false)} onConfirm={onClose} />}{removeConfirm && <ConfirmDialog title={draft.id === draft.presetId ? '移除此服务商配置？' : '删除此服务商？'} description="此服务商的已保存配置及密钥将被移除，默认模型会同步取消。" subject={draft.name} pending={busy === 'remove'} onClose={() => setRemoveConfirm(false)} onConfirm={() => void remove()} />}</div>
}
