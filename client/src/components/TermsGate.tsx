import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { api, ApiError } from '../lib/api'
import { TERMS_DATE } from '../lib/legal'

const READING_PAGES = ['/terms', '/returns', '/privacy', '/seller-terms', '/courier-terms']

interface TermsStatus {
  version: string
  accepted: boolean
  previousVersion: string | null
}

// Like Payfast's "Updates to our end-user agreement": a signed-in person accepts the current terms of use,
// returns & refunds policy and privacy notice once - and again whenever they change - before carrying on.
// The server keeps which version they accepted and when (and writes it in the audit log). Support staff
// are covered by their own agreement with the business, so they don't see this.
export function TermsGate() {
  const { user, logout } = useAuth()
  const path = useLocation().pathname
  const [status, setStatus] = useState<TermsStatus | null>(null)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setStatus(null)
    setAgree(false)
    if (!user || user.role === 'support') return
    api<TermsStatus>('/auth/terms')
      .then(setStatus)
      .catch(() => setStatus(null)) // offline or a hiccup: ask again next time, never block the app
  }, [user])

  // Not over the documents themselves: the links in the box open them to be read.
  if (!status || status.accepted || READING_PAGES.includes(path)) return null
  const changed = status.previousVersion !== null

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await api('/auth/terms', { method: 'POST', body: { version: status!.version } })
      setStatus({ ...status!, accepted: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog terms-gate" role="dialog" aria-modal="true" aria-labelledby="terms-title">
        <h2 id="terms-title">{changed ? 'Updates to our terms' : 'Before you continue'}</h2>
        <p>
          {changed
            ? `We updated our terms on ${TERMS_DATE}. Please read what changed and accept them to carry on.`
            : 'To buy, sell or deliver on KurumanMarketPlace, please read and accept:'}
        </p>
        <ul>
          <li>
            <Link to="/terms" target="_blank">
              Terms of use
            </Link>{' '}
            – how orders, payments, deliveries and reviews work, and your rights.
          </li>
          <li>
            <Link to="/returns" target="_blank">
              Returns &amp; refunds
            </Link>{' '}
            – cancelling, the 7-day cooling-off, faulty or wrong items, and how refunds are paid.
          </li>
          <li>
            <Link to="/privacy" target="_blank">
              Privacy notice
            </Link>{' '}
            – what we collect, who sees it, how long we keep it, and your rights under POPIA.
          </li>
          {user?.role === 'entrepreneur' && (
            <li>
              <Link to="/seller-terms" target="_blank">
                Seller terms
              </Link>{' '}
              – what you agreed to as a seller (also updated).
            </li>
          )}
          {user?.role === 'courier' && (
            <li>
              <Link to="/courier-terms" target="_blank">
                Courier terms
              </Link>{' '}
              – what you agree to as a courier: documents, cash, safety and customers’ information.
            </li>
          )}
        </ul>
        <label className="choice consent">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I agree to the above</span>
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-outline" onClick={() => logout()} disabled={busy}>
            Sign out
          </button>
          <button type="button" className="btn btn-primary" onClick={confirm} disabled={!agree || busy}>
            {busy ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
