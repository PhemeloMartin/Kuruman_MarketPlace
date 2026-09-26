import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../lib/api'

interface Props {
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  // Runs the action with the typed reason. Throwing an ApiError shows its message here.
  onConfirm: (reason: string) => Promise<void>
  onClose: () => void
}

// Every support decision needs a written reason (spec FR-21: "auditable reasons").
// The reason is saved with the decision and in the audit log.
export function ReasonDialog({ title, description, confirmLabel, danger, onConfirm, onClose }: Props) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  async function submit() {
    if (reason.trim().length < 5) {
      setError('Write a short reason (at least 5 characters).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onConfirm(reason.trim())
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
        <div className="field" data-invalid={Boolean(error)} style={{ marginBottom: 12 }}>
          <label htmlFor="reason">Reason (saved in the audit log)</label>
          <div className="input-wrap">
            <textarea id="reason" ref={inputRef} rows={3} maxLength={500} value={reason} onChange={(e) => {
                setReason(e.target.value)
                setError(null)
              }}
            />
          </div>
          {error && <p className="field-error">{error}</p>}
        </div>
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
