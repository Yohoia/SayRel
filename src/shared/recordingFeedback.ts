import { z } from 'zod'
import { MODES, type Mode } from './constants'
import { providerConfigurationIssue, selectedProvider, type ProviderService } from './providers'
import type { Settings } from './settings'

export const recordingIssueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('provider-setup'), service: z.enum(['transcription', 'refinement']), message: z.string() }),
  z.object({ kind: z.literal('microphone'), message: z.string() }),
  z.object({ kind: z.literal('refinement'), message: z.string(), canRetry: z.boolean() }),
  z.object({ kind: z.literal('processing'), message: z.string(), canRetry: z.boolean() })
])
export type RecordingIssue = z.infer<typeof recordingIssueSchema>

export const recordingStateSchema = z.object({
  phase: z.enum(['idle', 'long_pressing', 'starting', 'recording', 'finishing', 'error']),
  context: z.object({
    sessionId: z.string().nullable().default(null),
    mode: z.enum(MODES).optional(),
    handsFree: z.boolean().optional(),
    error: z.string().nullable().optional(),
    issue: recordingIssueSchema.nullable().optional(),
    recorderTimeoutState: z.object({ remainingTime: z.number(), timeUntilCountdown: z.number() }).nullable().optional()
  })
})

export function recordingSetupIssue(config: Settings, mode: Mode, { requireRefinement = false }: { requireRefinement?: boolean } = {}): RecordingIssue | null {
  const services: ProviderService[] = ['transcription']
  if (requireRefinement || mode === 'translation' || mode === 'ask_anything') services.push('refinement')
  for (const service of services) {
    const message = service === 'transcription'
      ? 'Choose a default transcription model in Providers before recording.'
      : 'Choose a default writing model in Providers before using this mode.'
    try {
      const selected = selectedProvider(config.serviceProviders, service)
      if (selected && !providerConfigurationIssue(selected.profile)) continue
    } catch {
      // A saved selection can outlive the provider or model it referenced.
    }
    return { kind: 'provider-setup', service, message }
  }
  return null
}
