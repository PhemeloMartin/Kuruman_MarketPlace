import { useState } from 'react'
import { QrCode } from './QrCode'
import { api, ApiError } from '../lib/api'

// The one-time code (and the same code as a QR code) the customer shows when they get their order
// (spec FR-13). Asking again gives a new code: the old one stops working.
export function HandoverCode({ orderId, showTo }: { orderId: number; showTo: 'courier' | 'seller' }) {
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function show() {
    setBusy(true)
    setError(null)
    try {
      setCode(await api<{ code: string; expiresAt: string }>(`/orders/${orderId}/handover-code`, { method: 'POST' }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not get a code. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!code) {
    return (
      <>
        <button type="button" className="btn btn-primary btn-block" onClick={show} disabled={busy}>
          {busy ? 'Getting code…' : showTo === 'courier' ? 'Show delivery code' : 'Show collection code'}
        </button>
        {error && <p className="field-error">{error}</p>}
      </>
    )
  }
  return (
    <>
      <span className="code" translate="no" aria-label={`Collection code ${code.code.split('').join(' ')}`}>
        {code.code}
      </span>
      <QrCode text={code.code} label="The same code as a QR code, for scanning" />
      <span className="fine-print">
        Show this to the {showTo} when you get your order. Valid until{' '}
        {new Date(code.expiresAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}.
      </span>
    </>
  )
}
