import { useId } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Modal } from './Modal'
import '../styles/feedback.css'

export function ConfirmDialog({ title, description, subject, pending = false, onConfirm, onClose }: {
  title: string; description: ReactNode; subject?: string; pending?: boolean; onConfirm: () => void; onClose: () => void
}) {
  const descriptionId = useId()
  const subjectId = useId()
  return createPortal(<div className="confirmation-dialog">
    <Modal title={title} onClose={onClose} role="alertdialog" descriptionId={subject ? `${descriptionId} ${subjectId}` : descriptionId} dismissible={!pending} showClose={false}>
      <div className="confirmation-description" id={descriptionId}>{description}</div>
      {subject && <p className="confirmation-subject" id={subjectId} title={subject}>{subject}</p>}
      <footer className="confirmation-actions"><button type="button" className="confirmation-cancel" data-dialog-autofocus disabled={pending} onClick={onClose}>取消</button><button type="button" className="confirmation-submit" disabled={pending} aria-busy={pending} onClick={onConfirm}>{pending && <span className="feedback-spinner" aria-hidden="true" />}{pending ? '处理中…' : '确认'}</button></footer>
    </Modal>
  </div>, document.body)
}
