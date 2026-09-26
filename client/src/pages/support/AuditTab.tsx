import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { dateTime } from '../../lib/labels'

interface AuditEvent {
  id: number
  action: string
  resourceType: string
  resourceId: string
  outcome: 'success' | 'refused' | 'failed'
  reason: string | null
  changes: Record<string, unknown> | null
  actorName: string | null
  occurredAt: string
}

const FILTERS = [
  { value: '', label: 'Everything' },
  { value: 'application.', label: 'Applications' },
  { value: 'business.', label: 'Shops' },
  { value: 'courier.', label: 'Couriers' },
  { value: 'mfa.', label: 'Authenticator codes' },
  { value: 'auth.', label: 'Sign-ins' },
]

// Read-only view of the audit log (spec FR-22). There is deliberately no edit or delete
// button - and the database would refuse even if there were.
export function AuditTab() {
  const [filter, setFilter] = useState('')
  const [events, setEvents] = useState<AuditEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<AuditEvent[]>(`/support/audit${filter ? `?action=${encodeURIComponent(filter)}` : ''}`)
      .then(setEvents)
      .catch((err) => setError(err.message))
  }, [filter])

  return (
    <>
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="audit-filter">Show</label>
        <div className="input-wrap">
          <select id="audit-filter" className="select" value={filter} onChange={(e) => setFilter(e.target.value)}>
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="notice error">{error}</p>}
      {events?.length === 0 && <p className="notice">Nothing recorded yet.</p>}
      {events && events.length > 0 && (
        <ol className="audit-list">
          {events.map((e) => (
            <li key={e.id} className="card">
              <div className="order-card-head">
                <code translate="no">{e.action}</code>
                <span className={`status-pill ${e.outcome === 'success' ? 'good' : 'bad'}`}>{e.outcome}</span>
              </div>
              <p className="product-meta" style={{ margin: '2px 0' }}>
                {e.actorName ?? 'System'} · {e.resourceType} #{e.resourceId} · {dateTime(e.occurredAt)}
              </p>
              {e.reason && <p style={{ margin: '4px 0 0' }}>“{e.reason}”</p>}
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
