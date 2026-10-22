import { useAppText } from '../../shared/i18n/useAppText'
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
const serviceLabels = { transcription: "Transcription", refinement: "Text refinement" }
type Draft = Omit<ProviderProfile, 'protocol'> & { protocol: string }
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)
const presetFor = (profile: Pick<ProviderProfile, 'presetId'>) => PROVIDER_PRESETS.find(preset => preset.id === profile.presetId)
const canDiscover = (protocol: string) => ['openai-chat', 'openai-responses', 'anthropic', 'gemini', 'ollama'].includes(protocol)

function blankProfile(service: ProviderService): Draft {
  return { id: `custom-${crypto.randomUUID()}`, presetId: 'custom', name: "Custom provider", service,
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
  const t = useAppText()
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
    <header className="page-heading"><div className="page-heading-copy"><h1 className="page-title">{t("Providers")}</h1></div></header>
    {error && <div className="providers-page-error" role="alert"><span>{t(error)}</span><button className="text-button" onClick={() => void reload()}>{t("Reload")}</button></div>}
    {loading ? <div className="hub-loading" role="status" aria-label={t("Loading providers")} /> : <>
      <div className="segmented-tabs providers-tabs" role="tablist" aria-label={t("Service type")}>{services.map(service => <button type="button" key={service} id={`provider-tab-${service}`} role="tab" aria-selected={activeService === service} aria-controls={`provider-panel-${service}`} tabIndex={activeService === service ? 0 : -1} onClick={() => setActiveService(service)} onKeyDown={event => {
        const next = event.key === 'Home' ? services[0] : event.key === 'End' ? services[services.length - 1] : event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? services.find(value => value !== service) : undefined
        if (next) { event.preventDefault(); setActiveService(next); document.getElementById(`provider-tab-${next}`)?.focus() }
      }}>{t(serviceLabels[service])}</button>)}</div>
      <div className="providers-groups">{services.map(service => {
        const presets = PROVIDER_PRESETS.filter(preset => preset.service === service)
        const presetIds = new Set(presets.map(preset => preset.id))
        const custom = state.profiles.filter(profile => profile.service === service && !presetIds.has(profile.id))
        return <section key={service} id={`provider-panel-${service}`} className="providers-group" role="tabpanel" aria-labelledby={`provider-tab-${service}`} hidden={activeService !== service}>
          <div className="providers-group-heading"><h2>{t(`${serviceLabels[service]} providers`)}</h2><button type="button" className="secondary-button providers-add-button" onClick={() => setDraft(blankProfile(service))}><Icon name="plus" />{t("Add")}</button></div>
          <div className="providers-cards">{[...presets.map(preset => ({ profile: state.profiles.find(profile => profile.id === preset.id) ?? createProviderProfile(preset), saved: state.profiles.some(profile => profile.id === preset.id) })), ...custom.map(profile => ({ profile, saved: true }))].map(({ profile, saved }) => {
            const preset = presetFor(profile)
            const selected = state[service]?.providerId === profile.id
            const configured = saved && !providerConfigurationIssue(profile)
            const enabled = saved && profile.enabled
            return <button type="button" className={`provider-card ${selected ? 'is-current' : ''}`} key={profile.id} data-provider-id={profile.id} onClick={() => setDraft({ ...profile, models: [...profile.models] })}>
              <span className="provider-card-main">{preset?.logo ? <img className="provider-logo" src={preset.logo} alt="" /> : <span className="provider-avatar">{profile.name.slice(0, 1).toUpperCase()}</span>}<span className="provider-card-name">{profile.name}</span><span className={`provider-status ${enabled ? 'is-ready' : ''}`} role="img" aria-label={enabled ? t("Enabled") : saved ? t("Disabled") : t("Not configured")} title={enabled ? t("Enabled") : saved ? t("Disabled") : t("Not configured")} /></span>
              <span className="provider-card-bottom"><span>{selected ? t(`In use · ${state[service]?.model}`) : configured ? t("Configured") : saved && !profile.enabled ? t("Disabled") : t("Click to configure")}</span><span aria-hidden="true">›</span></span>
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
  const t = useAppText()
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
  const providerName = preset?.name ?? draft.name
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
    if (requireModel && !parsed.data.models.length) { toast.error("Add at least one model"); return null }
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
      toast.success("Saved")
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
        if (result.ok) toast.success("Connection verified")
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
        if (models.length) toast.success(next.length > 200 ? "Models loaded. Showing the first 200." : "Models loaded")
        else toast.info("The provider returned no available models")
      }
    } catch (error) { if (alive.current && requestVersion === version.current) { toast.error(messageOf(error)) } }
    finally { if (alive.current) setBusy(null) }
  }
  const addModel = () => {
    const model = modelInput.trim()
    if (!model || model.length > 200) { toast.error("Enter a model ID of 1–200 characters"); return }
    if (draft.models.includes(model)) { toast.error("This model ID already exists"); return }
    if (draft.models.length >= 200) { toast.error("You can add up to 200 models"); return }
    edit({ models: [...draft.models, model] }); setModelInput('')
  }
  const remove = async () => {
    setBusy('remove')
    try { onUpdated(await providerApi.remove(draft.id)); toast.success("Deleted"); onClose() }
    catch (error) { toast.error(messageOf(error)) }
    finally { if (alive.current) setBusy(null) }
  }
  const protocols = draft.service === 'transcription' ? transcriptionProtocols : refinementProtocols
  const local = draft.protocol === 'local-whisper'
  const readyDraft = providerProfileSchema.safeParse(effectiveDraft)
  const issue = readyDraft.success ? providerConfigurationIssue(readyDraft.data) : "Enter a valid API base URL and model first"
  const selectedModel = draft.preferredModel ?? (selection?.providerId === draft.id && draft.models.includes(selection.model) ? selection.model : draft.models[0])
  const preview = requestPreview(draft, selectedModel)
  const secretField = (label: string, field: 'apiKey' | 'accessToken') => <div className="provider-field">
    <div className="provider-field-heading"><label htmlFor={`provider-${draft.id}-${field}`}>{t(label)}</label>{preset?.helpUrl && <button type="button" className="provider-inline-link" onClick={() => void api.page.openUrl(preset.helpUrl)}>{t("Get API key ↗")}</button>}</div>
    <div className="provider-secret"><input id={`provider-${draft.id}-${field}`} className="text-input" name={field} type={showSecrets ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={draft[field]} onChange={event => edit({ [field]: event.target.value })} /><button type="button" className="provider-reveal" aria-label={showSecrets ? t("Hide credentials") : t("Show credentials")} aria-pressed={showSecrets} title={showSecrets ? t("Hide credentials") : t("Show credentials")} onClick={() => setShowSecrets(value => !value)}>{showSecrets ? <VisibilityOffOutlined fontSize="inherit" /> : <VisibilityOutlined fontSize="inherit" />}</button></div>
    {!preset?.helpUrl && <span className="provider-help">{t("Leave blank for local services without authentication")}</span>}
  </div>
  return <div className="provider-dialog"><Modal title={!saved && initial.id.startsWith('custom-') ? t("Add provider") : t("Configure provider")} onClose={close}>
    <form onSubmit={event => { event.preventDefault(); void save() }}>
      <div className="provider-editor-heading">{preset?.logo ? <img className="provider-logo" src={preset.logo} alt="" /> : <span className="provider-avatar">{draft.name.slice(0, 1)}</span>}<div className="provider-editor-identity"><span className="provider-editor-name">{providerName === "Custom provider" ? t(providerName) : providerName}</span>{preview && <p className="provider-request-preview" aria-label={t("Full request URL")}><code title={preview}>{preview}</code></p>}</div><label className="provider-enabled"><span>{draft.enabled ? t("Enabled") : t("Disabled")}</span><button type="button" role="switch" aria-label={t("Enable provider")} aria-checked={draft.enabled} disabled={locked} className={`provider-switch ${draft.enabled ? 'is-on' : ''}`} aria-busy={busy === 'enabled'} onClick={() => void toggleEnabled()}><span /></button></label></div>
      <fieldset disabled={locked} className="provider-editor-fields">
        <div className={editableProtocol ? 'provider-field-pair' : undefined}><label className="provider-field"><span>{t("Name")}</span><input className="text-input" name="name" value={draft.name} maxLength={80} onChange={event => edit({ name: event.target.value })} /></label>{editableProtocol && <div className="provider-field"><span>{t("Protocol")}</span><HubSelect label={t("Protocol")} value={draft.protocol} options={protocols.map(protocol => ({ value: protocol, label: protocolLabels[protocol] }))} onChange={value => edit({ protocol: value })} /></div>}</div>
        {!local && <>
          {draft.protocol === 'volcengine-asr' && <div className="provider-field"><span>{t("Authentication")}</span><HubSelect label={t("Authentication")} value={volcMode} options={[{ value: 'api-key', label: t('API Key') }, { value: 'legacy', label: t('App ID + Access Token') }]} onChange={value => { setVolcMode(value); edit({}) }} /></div>}
          {draft.protocol === 'volcengine-asr' && volcMode === 'legacy' ? <><label className="provider-field"><span>{t("App ID")}</span><input className="text-input" name="appId" value={draft.appId} onChange={event => edit({ appId: event.target.value })} /></label>{secretField('Access Token', 'accessToken')}</> : secretField('API Key / Access Token', 'apiKey')}
          {draft.protocol === 'volcengine-asr' && <label className="provider-field"><span>{t("Resource ID")}</span><input className="text-input" name="resourceId" value={draft.resourceId} onChange={event => edit({ resourceId: event.target.value })} /></label>}
        </>}
        <label className="provider-field"><span>{local ? t("whisper-cli executable") : t("API base URL")}</span><input className="text-input" name="endpoint" value={draft.endpoint} placeholder={local ? '/usr/local/bin/whisper-cli' : 'https://api.example.com/v1'} autoComplete="off" spellCheck={false} onChange={event => edit({ endpoint: event.target.value })} /></label>
        {draft.protocol === 'azure-openai' && <label className="provider-field"><span>{t("API version")}</span><input className="text-input" name="apiVersion" value={draft.apiVersion} onChange={event => edit({ apiVersion: event.target.value })} /></label>}
        <section className="provider-model-section" aria-label={t("Model list")}><div className="provider-model-heading"><h3>{local ? t("Local model file path") : draft.protocol === 'azure-openai' ? t("Model deployment name") : t("Models")}</h3><div className="provider-model-heading-actions">{canDiscover(draft.protocol) && <button type="button" className="text-button" disabled={!!busy || !!testing} onClick={() => void discover()}>{busy === 'models' ? t("Fetching…") : t("Fetch models")}</button>}{preset?.docsUrl && <button type="button" className="provider-inline-link" onClick={() => void api.page.openUrl(preset.docsUrl)}>{t("Model docs ↗")}</button>}</div></div>
          <div className="provider-model-list" role="radiogroup" aria-label={t("Current model")}>{draft.models.map(model => {
            const current = selectedModel === model
            return <div className={`provider-model ${current ? 'is-current' : ''}`} key={model}>
              <button type="button" className="provider-model-select" role="radio" aria-checked={current} tabIndex={selectedModel === model ? 0 : -1} aria-label={t(`Select model ${model}`)} disabled={!!busy || !!testing} onClick={() => { if (!current) edit({ preferredModel: model }) }} onKeyDown={event => {
                if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const controls = Array.from(event.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])
                const index = controls.indexOf(event.currentTarget)
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (index + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? controls.length - 1 : 1)) % controls.length
                controls[next]?.focus(); controls[next]?.click()
              }}><span className="provider-model-indicator" aria-hidden="true" /><span className="provider-model-name">{model}</span></button>
              <button type="button" className="icon-button provider-model-remove" aria-label={t(`Remove model ${model}`)} disabled={!!busy || !!testing} onClick={() => edit({ models: draft.models.filter(value => value !== model) })}><Icon name="close" size={14} /></button>
            </div>
          })}{!draft.models.length && <p className="provider-model-empty">{t("Add a model ID, then select it to use it.")}</p>}</div>
          <div className="provider-add-model"><input className="text-input" name="model" aria-label={local ? t("Model file path") : t("Model ID")} value={modelInput} placeholder={local ? '/path/to/ggml-model.bin' : t("Enter model ID")} onChange={event => { ++version.current; setTesting(null); setModelInput(event.target.value); setDiscard(false) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addModel() } }} /><button type="button" className="secondary-button" onClick={addModel}>{t("Add model")}</button></div>
        </section>
      </fieldset>
      <footer className="provider-editor-footer"><div className="provider-footer-leading">{!local && <button type="button" className="secondary-button provider-test-connection" title={issue ? t(issue) : undefined} disabled={!!testing || !!busy} onClick={() => void test(selectedModel)}>{testing ? t("Testing…") : t("Test connection")}</button>}{saved && <button type="button" className="text-button provider-danger" disabled={!!busy} onClick={() => { setDiscard(false); setRemoveConfirm(true) }}>{draft.id === draft.presetId ? t("Remove configuration") : t("Delete provider")}</button>}</div><div className="provider-footer-actions"><button type="button" className="secondary-button" disabled={locked} onClick={close}>{t("Cancel")}</button><button type="submit" className="primary-button" disabled={!!busy}>{busy === 'save' ? t("Saving…") : t("Save configuration")}</button></div></footer>
    </form>
  </Modal>{discard && <ConfirmDialog title={t("Discard unsaved changes?")} description={t("Your unsaved changes will be lost.")} onClose={() => setDiscard(false)} onConfirm={onClose} />}{removeConfirm && <ConfirmDialog title={draft.id === draft.presetId ? t("Remove this provider configuration?") : t("Delete this provider?")} description={t("The saved configuration and credentials will be removed. Its default model will also be cleared.")} subject={draft.name} pending={busy === 'remove'} onClose={() => setRemoveConfirm(false)} onConfirm={() => void remove()} />}</div>
}
