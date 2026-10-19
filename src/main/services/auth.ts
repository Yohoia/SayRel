import { shell, safeStorage } from 'electron'
import Store from 'electron-store'
import { randomBytes, createHash } from 'node:crypto'
import { ENDPOINTS, PRODUCT } from '../../shared/constants'
import { createLogger } from '../lib/logger'
import { broadcast } from '../windows'
import { IPC } from '../../shared/ipc'
import type { AuthSession, UserInfo } from '../../shared/types'

const log = createLogger('auth')

type Persisted = {
  session: { cipher: string; userId: string } | null
  pendingState: string | null
}

const store = new Store<Persisted>({
  name: 'auth',
  defaults: { session: null, pendingState: null }
})

let cached: AuthSession | null = null
let loginInFlight = false

function encryptSession(session: AuthSession, userId: string): string {
  const plaintext = JSON.stringify(session)
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plaintext).toString('base64')
  }
  // Local-only fallback: obfuscated but not secret. Encryption is preferred.
  return Buffer.from(plaintext, 'utf8').toString('base64')
}

function decryptSession(cipher: string): AuthSession | null {
  try {
    const buffer = Buffer.from(cipher, 'base64')
    const plaintext = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buffer)
      : buffer.toString('utf8')
    return JSON.parse(plaintext) as AuthSession
  } catch (err) {
    log.error('failed to decrypt session', err)
    return null
  }
}

export function getCurrentSession(): AuthSession | null {
  if (cached) return cached
  const persisted = store.get('session')
  if (!persisted) return null
  cached = decryptSession(persisted.cipher)
  return cached
}

export function isLoggedIn(): boolean {
  const session = getCurrentSession()
  if (!session) return false
  if (!session.expiresAt) return true
  return Date.now() < session.expiresAt
}

export function getCurrentUser(): UserInfo | null {
  return getCurrentSession()?.user ?? null
}

export function getAccessToken(): string | null {
  return getCurrentSession()?.accessToken ?? null
}

function persistSession(session: AuthSession): void {
  cached = session
  store.set('session', {
    cipher: encryptSession(session, session.userId),
    userId: session.userId
  })
}

export function clearSession(): void {
  cached = null
  store.set('session', null)
}

/** PKCE pair for the browser-based login flow. */
export function createLoginChallenge(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('base64url')
  store.set('pendingState', state)
  return { verifier, challenge, state }
}

export async function startAppLogin(): Promise<{ url: string; state: string }> {
  if (loginInFlight) throw new Error('login already in progress')
  loginInFlight = true
  broadcast(IPC.AUTH_APP_LOGIN_LOADING_CHANGED, true)
  const { challenge, state, verifier } = createLoginChallenge()
  // The verifier stays in this process and is exchanged with the code.
  ;(globalThis as any).__offkeyPkce = { verifier, state }

  const url = new URL(`${ENDPOINTS.web}/login/app`)
  url.searchParams.set('scheme', PRODUCT.urlScheme)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')

  await shell.openExternal(url.toString())
  return { url: url.toString(), state }
}

/** Called by the custom-protocol handler once the browser redirects back. */
export async function completeAppLogin(code: string, state: string): Promise<AuthSession> {
  const pending = (globalThis as any).__offkeyPkce as { verifier: string; state: string } | undefined
  if (!pending || pending.state !== state) {
    loginInFlight = false
    broadcast(IPC.AUTH_APP_LOGIN_FAILED, 'state-mismatch')
    throw new Error('login state mismatch')
  }
  try {
    const response = await fetch(`${ENDPOINTS.api}/oauth/exchange_app_login_code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: pending.verifier,
        client_id: PRODUCT.bundleId
      })
    })
    if (!response.ok) throw new Error(`exchange failed: ${response.status}`)
    const payload = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
      user?: UserInfo
    }
    const session: AuthSession = {
      userId: payload.user?.id ?? 'local',
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : null,
      user: payload.user ?? null
    }
    persistSession(session)
    return session
  } finally {
    loginInFlight = false
    broadcast(IPC.AUTH_APP_LOGIN_LOADING_CHANGED, false)
    ;(globalThis as any).__offkeyPkce = undefined
  }
}

export async function refreshAccessToken(): Promise<AuthSession | null> {
  const session = getCurrentSession()
  if (!session?.refreshToken) return null
  try {
    const response = await fetch(`${ENDPOINTS.api}/oauth/refresh_access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refreshToken, client_id: PRODUCT.bundleId })
    })
    if (!response.ok) throw new Error(`refresh failed: ${response.status}`)
    const payload = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
      user?: UserInfo
    }
    const next: AuthSession = {
      ...session,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? session.refreshToken,
      expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : session.expiresAt,
      user: payload.user ?? session.user
    }
    persistSession(next)
    return next
  } catch (err) {
    log.error('token refresh failed', err)
    return null
  }
}

export async function logout(): Promise<void> {
  const session = getCurrentSession()
  clearSession()
  if (session?.accessToken) {
    try {
      await fetch(`${ENDPOINTS.api}/oauth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${session.accessToken}` }
      })
    } catch {
      /* logout is local-first */
    }
  }
}
