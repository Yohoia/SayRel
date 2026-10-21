import { providerModelsSchema, providerTestResultSchema, serviceProvidersSchema, type ProviderProfile, type ProviderSelection, type ProviderService } from '../../../shared/providers'
import { bridge } from './bridge'

export const providerApi = {
  async get() { return serviceProvidersSchema.parse(await bridge.invoke('providers:get')) },
  async save(profile: ProviderProfile, activateModel?: string) {
    return serviceProvidersSchema.parse(await bridge.invoke('providers:manage', { action: 'save', profile, ...(activateModel ? { activateModel } : {}) }))
  },
  async remove(id: string) { return serviceProvidersSchema.parse(await bridge.invoke('providers:manage', { action: 'remove', id })) },
  async select(service: ProviderService, selection: ProviderSelection | null) { return serviceProvidersSchema.parse(await bridge.invoke('providers:manage', { action: 'select', service, selection })) },
  async test(profile: ProviderProfile, model: string) { return providerTestResultSchema.parse(await bridge.invoke('providers:manage', { action: 'test', profile, model })) },
  async models(profile: ProviderProfile) { return providerModelsSchema.parse(await bridge.invoke('providers:manage', { action: 'models', profile })) }
}
