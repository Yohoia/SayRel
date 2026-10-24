import type { Ref } from 'react'
import type { RecordingIssue } from '../../shared/recordingFeedback'
import { Icon } from '../shared/components/Icons'
import { useAppText } from '../shared/i18n/useAppText'

export function FloatingAlert({ issue, busy, actionError, alertRef, onDismiss, onAction }: {
  issue: RecordingIssue
  busy: boolean
  actionError: string | null
  alertRef: Ref<HTMLDivElement>
  onDismiss: () => void
  onAction: () => void
}) {
  const t = useAppText()
  const content = issue.kind === 'provider-setup'
    ? {
      title: issue.service === 'transcription' ? 'Set up voice input' : 'Set up this voice mode',
      description: issue.service === 'transcription'
        ? 'Add a transcription provider and choose its default model to turn your voice into text.'
        : 'Choose a default writing model to translate your speech or answer questions.',
      action: 'Open Providers'
    }
    : issue.kind === 'microphone'
      ? { title: 'Microphone unavailable', description: issue.message, action: 'Check microphone' }
      : issue.kind === 'refinement'
        ? { title: 'Original transcript used', description: issue.message, action: 'Retry refinement' }
      : { title: 'Could not finish your dictation', description: issue.message, action: issue.canRetry ? 'Retry' : 'Record again' }
  return <div className="floating-alert" role="alert" aria-labelledby="floating-alert-title" ref={alertRef} data-issue={issue.kind}>
    <div className="floating-alert-heading">
      <svg className="floating-alert-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" /><path d="M10 5.5v5M10 13.5v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      <h2 id="floating-alert-title">{t(content.title)}</h2>
      <button className="floating-alert-close" onClick={onDismiss} disabled={busy} aria-label={t('Dismiss notification')} title={t('Dismiss notification')}><Icon name="close" size={16} /></button>
    </div>
    <p className="floating-alert-description">{t(content.description)}</p>
    {issue.kind === 'processing' && issue.canRetry && <p className="floating-alert-retained">{t('Your recording is kept for retry.')}</p>}
    {actionError && <p className="floating-alert-action-error">{t(actionError)}</p>}
    <div className="floating-alert-actions">
      <button className="floating-alert-primary" onClick={onAction} disabled={busy}>{t(busy ? 'Opening…' : content.action)}</button>
      <button className="floating-alert-secondary" onClick={onDismiss} disabled={busy}>{t('Close')}</button>
    </div>
  </div>
}
