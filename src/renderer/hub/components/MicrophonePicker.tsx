import { useEffect, useId, useState } from 'react'
import { z } from 'zod'
import ButtonBase from '@mui/material/ButtonBase'
import { recordingStateSchema } from '../../../shared/recordingFeedback'
import { api } from '../../shared/utils/bridge'
import { Modal } from '../../shared/components/Modal'
import { toast } from '../../shared/components/Toast'
import { useAppSettings } from '../../shared/state/settings'
import { useMicrophoneVolume } from '../../shared/audio/useMicrophoneVolume'
import { useSettingsText } from './settingsText'

const nativeDevicesSchema = z.array(z.object({
  label: z.string(), isDefault: z.boolean(), transport: z.string().nullable().optional()
}))

export function MicrophoneLevel({ volume }: { volume: number }) {
  const level = Math.max(0, Math.min(1, volume))
  const count = level < .12 ? 0 : Math.ceil(level * 6)
  const t = useSettingsText()
  return <span className="settings-mic-level" role="meter" aria-label={t('Microphone level')} aria-valuenow={Math.round(level * 100)} aria-valuemin={0} aria-valuemax={100}>
    {Array.from({ length: 6 }, (_, index) => <i key={index} className={index < count ? 'is-active' : undefined} />)}
  </span>
}

export function MicrophonePicker({ autoOpen = false }: { autoOpen?: boolean }) {
  const { settings, patch } = useAppSettings()
  const t = useSettingsText()
  const descriptionId = useId()
  const [open, setOpen] = useState(autoOpen)
  const [present, setPresent] = useState(autoOpen)
  const [nativeDevices, setNativeDevices] = useState<z.infer<typeof nativeDevicesSchema>>([])
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [devicesLoaded, setDevicesLoaded] = useState(false)
  const [selected, setSelected] = useState(settings.micDevice ?? '')
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [saving, setSaving] = useState(false)
  const volume = useMicrophoneVolume(analyser, 20)

  useEffect(() => { if (autoOpen) setOpen(true) }, [autoOpen])
  useEffect(() => {
    if (open) { setPresent(true); return }
    const timer = window.setTimeout(() => setPresent(false), 200)
    return () => window.clearTimeout(timer)
  }, [open])
  useEffect(() => {
    let disposed = false
    const refresh = async () => {
      const [browser, native] = await Promise.allSettled([
        navigator.mediaDevices.enumerateDevices(),
        api.audio.getDevices().then((value: unknown) => nativeDevicesSchema.parse(value))
      ])
      if (disposed) return
      if (browser.status === 'fulfilled') {
        setDevices(browser.value.filter(device => device.kind === 'audioinput' && device.deviceId !== 'default'))
        setDevicesLoaded(true)
      }
      if (native.status === 'fulfilled') setNativeDevices(native.value)
    }
    void refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => { disposed = true; navigator.mediaDevices.removeEventListener('devicechange', refresh) }
  }, [open])
  useEffect(() => {
    if (!open) return
    let disposed = false
    let stream: MediaStream | undefined, context: AudioContext | undefined
    const refresh = () => { void navigator.mediaDevices.enumerateDevices().then(list => {
      if (!disposed) { setDevices(list.filter(device => device.kind === 'audioinput' && device.deviceId !== 'default')); setDevicesLoaded(true) }
    }).catch(() => undefined) }
    void (async () => {
      try {
        const value: unknown = await api.recording.state()
        const state = recordingStateSchema.parse(value)
        if (disposed) return
        if (!['idle', 'error'].includes(state.phase)) { toast.info(t('Finish the current recording first')); return }
        stream = await navigator.mediaDevices.getUserMedia({ audio: {
          ...(selected ? { deviceId: { exact: selected } } : {}), noiseSuppression: true
        }, video: false })
        if (disposed) { stream.getTracks().forEach(track => track.stop()); return }
        refresh()
        context = new AudioContext()
        const meter = context.createAnalyser()
        context.createMediaStreamSource(stream).connect(meter)
        await context.resume()
        if (!disposed) setAnalyser(meter)
      } catch (failure) {
        if (!disposed) toast.error(t(failure instanceof Error ? failure.message : 'Microphone unavailable'))
      }
    })()
    return () => {
      disposed = true
      setAnalyser(null)
      stream?.getTracks().forEach(track => track.stop())
      void context?.close().catch(() => undefined)
    }
  }, [open, selected, t])

  useEffect(() => {
    if (devicesLoaded && selected && !devices.some(device => device.deviceId === selected)) setSelected('')
  }, [devices, devicesLoaded, selected])

  const defaultName = nativeDevices.find(device => device.isDefault)?.label
  const autoLabel = t('Auto-detect') + (defaultName ? ` (${defaultName})` : '')
  const description = (device: MediaDeviceInfo) => {
    const native = nativeDevices.find(item => item.label === device.label)
    if (native?.transport === 'builtin') return { text: t('Recommended'), recommended: true }
    if (native?.transport === 'bluetooth') return { text: t('Bluetooth microphone'), recommended: false }
    return { text: native?.transport ? t('External microphone') : '', recommended: false }
  }
  const selectDevice = async (value: string) => {
    if (value === selected || saving) return
    setSaving(true)
    try { await patch({ micDevice: value || null }); setSelected(value) }
    catch { return }
    finally { setSaving(false) }
  }
  return <>
    <button className="settings-picker" onClick={() => { setSelected(settings.micDevice ?? ''); setOpen(true) }}>
      <span>{settings.micDevice ? devices.find(device => device.deviceId === settings.micDevice)?.label || t('Unknown Device') : autoLabel}</span><span aria-hidden>⌄</span>
    </button>
    {(open || present) && <div className={`settings-subdialog settings-microphone-dialog${open ? '' : ' is-closing'}`}>
      <Modal title={t('Microphone')} onClose={() => setOpen(false)} descriptionId={descriptionId} dismissible={open}>
        <p id={descriptionId} className="settings-mic-description">{t("Choose the microphone that captures your voice. If the bar doesn't move, try a different microphone.")}</p>
        <div className="settings-mic-body">
          {devices.length ? <div className="settings-mic-list" role="radiogroup" aria-label={t('Microphone')}>
            <ButtonBase type="button" role="radio" aria-checked={!selected} disabled={saving} className="settings-mic-option" onClick={event => { event.currentTarget.scrollIntoView({ block: 'nearest' }); void selectDevice('') }}>
              <span className="settings-mic-copy"><span>{autoLabel}</span><small>{t('Uses system default microphone')}</small></span>
              {!selected && <MicrophoneLevel volume={volume} />}
            </ButtonBase>
            {[...devices].sort((first, second) => Number(description(second).recommended) - Number(description(first).recommended)).map(device => {
              const detail = description(device)
              return <ButtonBase type="button" role="radio" aria-checked={selected === device.deviceId} disabled={saving} className="settings-mic-option" key={device.deviceId} onClick={event => { event.currentTarget.scrollIntoView({ block: 'nearest' }); void selectDevice(device.deviceId) }}>
                <span className="settings-mic-copy"><span>{device.label || t('Unknown Device')}</span>{detail.text && <small className={detail.recommended ? 'is-recommended' : undefined}>{detail.text}</small>}</span>
                {selected === device.deviceId && <MicrophoneLevel volume={volume} />}
              </ButtonBase>
            })}
          </div> : <div className="settings-mic-empty"><strong>{t('No microphone detected')}</strong><p>{t('Check your device settings or connect a microphone.')}</p></div>}
        </div>
      </Modal>
    </div>}
  </>
}
