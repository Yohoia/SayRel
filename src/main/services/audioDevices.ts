import { util } from '../lib/native'
import { createLogger } from '../lib/logger'
import type { AudioDeviceInfo } from '../../shared/types'

const log = createLogger('audio-devices')

let cache: AudioDeviceInfo[] | null = null

export async function listAudioDevices(force = false): Promise<AudioDeviceInfo[]> {
  if (cache && !force) return cache
  let raw: any[] = []
  try {
    if (util.available) {
      raw = await util.getAudioDevicesJSONAsync()
      if (!raw.length) {
        const json = util.getAudioDevicesJSON?.()
        if (json) raw = JSON.parse(json)
      }
    }
  } catch (err) {
    log.error('failed to enumerate audio devices', err)
  }
  cache = raw.map((d) => ({
    deviceId: String(d.deviceId ?? ''),
    label: String(d.label ?? 'Microphone'),
    isDefault: Boolean(d.isDefault),
    transport: d.transport ?? null
  }))
  return cache
}

export function invalidateAudioDevices(): void {
  cache = null
}
