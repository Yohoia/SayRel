import { shell, safeStorage } from 'electron'
import Store from 'electron-store'
import { randomBytes, createHash } from 'node:crypto'
import { ENDPOINTS, PRODUCT } from '../../shared/constants'
import { createLogger } from '../lib/logger'
import { broadcast } from '../windows'
import { IPC } from '../../shared/ipc'
import type { AuthSession, UserInfo } from '../../shared/types'
import { TokenResponseSchema, UserInfoResponseSchema, parseApiResponse } from '../../shared/api-schemas'

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

// Secure storage for pending PKCE flows (replaces globalThis usage)
const pendingLogins = new Map<string, { verifier: string; state: string; timestamp: number }>()

function encryptSession(session: AuthSession, userId: string): string {
  const plaintext = JSON.stringify(session)
  if (!safeStorage.isEncryptionAvailable()) {
    log.error('safeStorage encryption not available - refusing to persist session')
    throw new Error('Cannot persist session: encryption not available on this system')
  }
  return safeStorage.encryptString(plaintext).toString('base64')
}

function decryptSession(cipher: string): AuthSession | null {
  if (!safeStorage.isEncryptionAvailable()) {
    log.error('Cannot decrypt session: encryption not available')
    // Security: Never fall back to plaintext decryption
    return null
  }

  try {
    const buffer = Buffer.from(cipher, 'base64')
    const plaintext = safeStorage.decryptString(buffer)
    const parsed = JSON.parse(plaintext)

    // Validate the parsed session structure
    if (!parsed || typeof parsed !== 'object') {
      log.error('Invalid session structure')
      return null
    }

    return parsed as AuthSession
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
  if (!session.expiresAt || session.expiresAt <= 0) return true
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

  // Clean up stale login attempts (older than 10 minutes)
  const now = Date.now()
  for (const [key, value] of pendingLogins.entries()) {
    if (now - value.timestamp > 600_000) {
      pendingLogins.delete(key)
    }
  }

  const { challenge, state, verifier } = createLoginChallenge()
  // Store PKCE verifier securely in closure-scoped Map instead of globalThis
  pendingLogins.set(state, { verifier, state, timestamp: now })

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
  const pending = pendingLogins.get(state)
  if (!pending || pending.state !== state) {
    loginInFlight = false
    broadcast(IPC.AUTH_APP_LOGIN_FAILED, 'state-mismatch')
    throw new Error('login state mismatch')
  }

  // Clean up the pending login immediately
  pendingLogins.delete(state)

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

    // Validate response with zod schema
    const json = await response.json()
    const payload = parseApiResponse(TokenResponseSchema, json, 'token exchange')

    // Validate user info if present
    let user: UserInfo | null = null
    if ('user' in json && json.user) {
      user = parseApiResponse(UserInfoResponseSchema, json.user, 'user info')
    }

    const session: AuthSession = {
      userId: user?.id ?? 'local',
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : null,
      user: user
    }
    persistSession(session)
    return session
  } finally {
    loginInFlight = false
    broadcast(IPC.AUTH_APP_LOGIN_LOADING_CHANGED, false)
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
