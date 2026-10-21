import { providerActionSchema, providerConfigurationIssue, updateProviderState } from '../../shared/providers'
import { settings } from '../lib/settings'
import { listProviderModels, testProvider } from '../services/providers'
import { broadcast } from '../windows'
import type { Handler } from './index'

export function registerProviderHandlers(handle: (channel: string, fn: Handler) => void): void {
  handle('providers:get', () => settings.get().serviceProviders)
  handle('providers:manage', async (_event, raw: unknown) => {
    const parsed = providerActionSchema.safeParse(raw)
    if (!parsed.success) throw new Error(parsed.error.issues.map(issue => issue.message).join('；'))
    const action = parsed.data
    if (action.action === 'test' || action.action === 'models') {
      const issue = providerConfigurationIssue(action.profile, action.action !== 'models')
      if (issue) throw new Error(issue)
      if (action.action === 'models') return listProviderModels(action.profile)
      if (!action.profile.models.includes(action.model)) throw new Error('请选择此服务商的模型')
      return testProvider(action.profile, action.model)
    }
    const state = updateProviderState(settings.get().serviceProviders, action)
    const next = settings.patch({ serviceProviders: state })
    broadcast('store:changed', next)
    return next.serviceProviders
  })
}
