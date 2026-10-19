import * as auth from '../services/auth'
import { onboardingWindow, openHub, loginWindow } from '../windows'
import type { Handler } from './index'

export function registerAuthHandlers(handle: (c: string, f: Handler) => void): void {
  handle('auth:get-current', () => auth.getCurrentUser())
  handle('auth:get-access-token', () => auth.getAccessToken())
  handle('auth:is-logged-in', () => auth.isLoggedIn())

  handle('auth:login', async () => {
    const result = await auth.startAppLogin()
    loginWindow.createWindow()
    loginWindow.show()
    return result
  })

  handle('auth:start-app-login', async () => auth.startAppLogin())

  handle('auth:logout', async () => {
    await auth.logout()
    return true
  })

  handle('onboarding:get-user-profile-surveys', async () => {
    const token = auth.getAccessToken()
    if (!token) return []
    try {
      const response = await fetch('https://api.offkey.app/user/get_user_surveys', {
        headers: { authorization: `Bearer ${token}` }
      })
      if (!response.ok) return []
      return await response.json()
    } catch {
      return []
    }
  })

  handle('onboarding:submit-user-profile-survey', async (_e, payload: unknown) => {
    const token = auth.getAccessToken()
    if (!token) return { ok: false }
    try {
      const response = await fetch('https://api.offkey.app/user/submit_survey', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      })
      return { ok: response.ok }
    } catch {
      return { ok: false }
    }
  })

  handle('page:open-login', () => {
    loginWindow.createWindow()
    loginWindow.show()
    return true
  })

  handle('page:close-onboarding', () => {
    onboardingWindow.closeWindow()
    openHub('main')
    return true
  })
}
