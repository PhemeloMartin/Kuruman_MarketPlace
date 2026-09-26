import { useCallback, useEffect, useState } from 'react'
import { ReasonDialog } from '../../components/ReasonDialog'
import { api } from '../../lib/api'
import { dateTime } from '../../lib/labels'

interface PrivacyCase {
  id: number
  type: 'access' | 'correction' | 'deletion'
  status: 'open' | 'closed'
  requester: { id: number; name: string; role: string }
  details: { text?: string; erased?: boolean }
  holds: string[]
  dueAt: string | null
  createdAt: string
  closedAt: string | null
  resolution: string | null
  reason: string | null
  resolvedBy: string | null
}

type Action = { kind: 'close-account' | 'hold' | 'resolve'; c: PrivacyCase }

const TYPE_LABEL = { access: 'Data download', correction: 'Correction', deletion: 'Close account' }

// Privacy requests (spec FR-20, UC-16). Scope "privacy" only.
// Account closure is refused by the server while any hold exists; the holds shown here are
// worked out live each time the list loads.
export function PrivacyTab() {
  const [cases, setCases] = useState<PrivacyCase[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<Action | null>(null)

  const load = useCallback(() => {
    api<PrivacyCase[]>('/support/privacy/cases')
      .then(setCases)
      .catch((err) => setError(err.message))
  }, [])
  useEffect(load, [load])

  if (!cases) return error ? <p className="notice error">{error}</p> : <div className="skeleton" style={{ minHeight: 200 }} />

  const open = cases.filter((c) => c.status === 'open')
  const closed = cases.filter((c) => c.status === 'closed')

  return (
    <>
      <div className="section-head">
        <h2>Open privacy requests</h2>
      </div>
      {open.length === 0 && <p className="notice">No requests waiting.</p>}
      {open.map((c) => (
        <article key={c.id} className="card">
          <div className="order-card-head">
            <strong>{TYPE_LABEL[c.type]}</strong>
            <span className="status-pill wait">Due {c.dueAt ? dateTime(c.dueAt) : '–'}</span>
          </div>
          <p className="product-meta" style={{ margin: '2px 0 8px' }}>
            {c.requester.name} ({c.requester.role}) · asked {dateTime(c.createdAt)}
          </p>
          {c.details.text && <p style={{ margin: '0 0 8px' }}>“{c.details.text}”</p>}
          {c.type === 'deletion' &&
            (c.holds.length ? (
              <div className="notice error" style={{ marginBottom: 8 }}>
                <strong>Can’t close yet:</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {c.holds.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="notice" style={{ marginBottom: 8 }}>
                Nothing is in progress. Closing erases the phone number, passphrase, name and addresses; orders and
                payments stay as “Closed account”.
              </p>
            ))}
          <div className="btn-row">
            {c.type === 'deletion' ? (
              <>
                <button type="button" className="btn btn-danger" disabled={c.holds.length > 0} onClick={() => setAction({ kind: 'close-account', c })}>
                  Close account
                </button>
                <button type="button" className="btn btn-outline" onClick={() => setAction({ kind: 'hold', c })}>
                  Explain hold
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => setAction({ kind: 'resolve', c })}>
                Corrected
              </button>
            )}
          </div>
        </article>
      ))}

      {closed.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 20 }}>
            <h2>Recently handled</h2>
          </div>
          {closed.map((c) => (
            <article key={c.id} className="card">
              <div className="order-card-head">
                <strong>{TYPE_LABEL[c.type]}</strong>
                <span className={`status-pill ${c.resolution === 'held' ? 'wait' : 'good'}`}>{c.resolution}</span>
              </div>
              <p className="fine-print" style={{ margin: 0 }}>
                {c.requester.name} · “{c.reason}” — {c.resolvedBy ?? 'self-service'}, {c.closedAt && dateTime(c.closedAt)}
              </p>
            </article>
          ))}
        </>
      )}

      {action && (
        <ReasonDialog
          title={
            action.kind === 'close-account' ? 'Close this account?' : action.kind === 'hold' ? 'Explain why it must wait' : 'Correction done?'
          }
          description={
            action.kind === 'close-account'
              ? 'This can’t be undone. The person is signed out everywhere and can no longer sign in.'
              : action.kind === 'hold'
                ? 'The person sees this reason on their profile and can ask again later.'
                : 'Say what was corrected. The person sees that their request is done.'
          }
          confirmLabel={action.kind === 'close-account' ? 'Close account' : action.kind === 'hold' ? 'Send' : 'Mark as done'}
          danger={action.kind === 'close-account'}
          onClose={() => setAction(null)}
          onConfirm={async (reason) => {
            await api(`/support/privacy/cases/${action.c.id}/${action.kind}`, { method: 'POST', body: { reason } })
            setAction(null)
            load()
          }}
        />
      )}
    </>
  )
}
