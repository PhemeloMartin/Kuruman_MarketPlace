import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../lib/api'

interface ExtraField {
  label: string
  initial?: string
  inputMode?: 'text' | 'decimal'
  hint?: string
}

interface Props {
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  // One optional extra input, e.g. the refund amount or Payfast's refund reference.
  field?: ExtraField
  askReason?: boolean // default true
  // Runs the action. Throwing an ApiError shows its message here.
  onConfirm: (reason: string, fieldValue: string) => Promise<void>
  onClose: () => void
}

// Every support decision needs a written reason (spec FR-21: "auditable reasons").
// The reason is saved with the decision and in the audit log.
export function ReasonDialog({ title, description, confirmLabel, danger, field, askReason = true, onConfirm, onClose }: Props) {
  const [reason, setReason] = useState('')
  const [value, setValue] = useState(field?.initial ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const firstRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  async function submit() {
    if (askReason && reason.trim().length < 5) {
      setError('Write a short reason (at least 5 characters).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onConfirm(reason.trim(), value.trim())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={() => !busy && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="reason-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="reason-title">{title}</h2>
        <p>{description}</p>
        {field && (
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor="dialog-field">{field.label}</label>
            <div className="input-wrap">
              <input
                id="dialog-field"
                ref={firstRef}
                inputMode={field.inputMode ?? 'text'}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value)
                  setError(null)
                }}
              />
            </div>
            {field.hint && <p className="fine-print" style={{ margin: '4px 0 0' }}>{field.hint}</p>}
          </div>
        )}
        {askReason && (
          <div className="field" data-invalid={Boolean(error)} style={{ marginBottom: 12 }}>
            <label htmlFor="reason">Reason (saved in the audit log)</label>
            <div className="input-wrap">
              <textarea
                id="reason"
                ref={field ? undefined : firstRef}
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value)
                  setError(null)
                }}
              />
            </div>
          </div>
        )}
        {error && (
          <p className="field-error" role="alert" style={{ marginTop: -4, marginBottom: 12 }}>
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : confirmLabel}
          </button>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Back
          </button>
        </div>
      </div>
    </div>
  )
}
