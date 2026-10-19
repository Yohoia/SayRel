import { Icon } from '../shared/Icons'

/** Typeless uses ten quiet grey dots for both the hover and error pill. */
export function StatusIcons({ status }: { status: string }) {
  if (status === 'starting-microphone') return null
  if (status === 'hover' || status === 'error') {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, height: 24, width: '100%', padding: '4px 8px' }}>{Array.from({ length: 10 }, (_, i) => <span key={i} style={{ width: 2, height: 2, flexShrink: 0, background: '#808080' }} />)}</div>
  }
  return <Icon name="mic" size={14} style={{ color: '#fff' }} />
}
