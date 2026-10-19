import { publicEncrypt, constants, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import Store from 'electron-store'
import { createLogger } from './logger'

const log = createLogger('sidecar')

type RsaConfig = { enabled: boolean; publicKey: string | null }

const store = new Store<RsaConfig>({
  name: 'rsa',
  defaults: { enabled: false, publicKey: null }
})

/**
 * Optional payload encryption for enterprise deployments. Keys never leave
 * the device in plaintext: only the public key is stored locally.
 */
export const rsa = {
  getConfig(): RsaConfig {
    return { enabled: store.get('enabled'), publicKey: store.get('publicKey') }
  },
  setConfig(config: unknown): RsaConfig {
    const next = config as Partial<RsaConfig>
    if (typeof next.enabled === 'boolean') store.set('enabled', next.enabled)
    if (typeof next.publicKey === 'string' || next.publicKey === null) {
      store.set('publicKey', next.publicKey)
    }
    return this.getConfig()
  },
  isEnabled(): boolean {
    return store.get('enabled') && Boolean(store.get('publicKey'))
  },
  encrypt(value: string): string {
    const key = store.get('publicKey')
    if (!key) return value
    try {
      return publicEncrypt(
        { key, padding: constants.RSA_PKCS1_OAEP_PADDING },
        Buffer.from(value, 'utf8')
      ).toString('base64')
    } catch (err) {
      log.error('rsa encrypt failed', err)
      return value
    }
  },
  clear(): boolean {
    store.set('enabled', false)
    store.set('publicKey', null)
    return true
  }
}

/** AES-GCM helpers for cached tokens at rest. */
export const aes = {
  encrypt(plaintext: string, key: Buffer): { iv: string; data: string; tag: string } {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return { iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
  },
  decrypt(payload: { iv: string; data: string; tag: string }, key: Buffer): string {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(payload.data, 'base64')),
      decipher.final()
    ]).toString('utf8')
  }
}

export const sidecar = { rsa, aes }
