import { useCallback, useEffect, useState } from 'react'
import { ReasonDialog } from '../../components/ReasonDialog'
import { api } from '../../lib/api'
import { VEHICLE_LABEL, dateTime, localPhone } from '../../lib/labels'

interface Application {
  id: number
  type: 'seller' | 'courier'
  status: 'open' | 'closed'
  applicant: { name: string; phone: string }
  details: Record<string, string>
  resolution: 'approved' | 'rejected' | null
  reason: string | null
  resolvedBy: string | null
  createdAt: string
  closedAt: string | null
}

// Seller and courier applications (spec FR-02, UC-02). Approving gives the person the role
// and creates their business or courier profile in one server transaction.
export function ApplicationsTab() {
  const [apps, setApps] = useState<Application[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<{ app: Application; action: 'approve' | 'reject' } | null>(null)

  const load = useCallback(() => {
    api<Application[]>('/support/applications')
      .then(setApps)
      .catch((err) => setError(err.message))
  }, [])
  useEffect(load, [load])

  if (!apps) return error ? <p className="notice error">{error}</p> : <div className="skeleton" style={{ minHeight: 200 }} />

  const open = apps.filter((a) => a.status === 'open')
  const closed = apps.filter((a) => a.status === 'closed')

  return (
    <>
      <div className="section-head">
        <h2>Waiting for a decision</h2>
      </div>
      {open.length === 0 && <p className="notice">No applications waiting.</p>}
      {open.map((a) => (
        <article key={a.id} className="card">
          <div className="order-card-head">
            <strong>{a.type === 'seller' ? a.details.businessName : `Courier: ${a.applicant.name}`}</strong>
            <span className="status-pill">{a.type === 'seller' ? 'Wants to sell' : 'Wants to deliver'}</span>
          </div>
          <dl className="details">
            <dt>Applicant</dt>
            <dd>
              {a.applicant.name} · <span translate="no">{localPhone(a.applicant.phone)}</span>
            </dd>
            {a.type === 'seller' ? (
              <>
                <dt>Area</dt>
                <dd>{a.details.area}</dd>
                <dt>Pickup address</dt>
                <dd>{a.details.pickupAddress}</dd>
                <dt>Business phone</dt>
                <dd translate="no">{localPhone(a.details.phone)}</dd>
                {a.details.description && (
                  <>
                    <dt>About</dt>
                    <dd>{a.details.description}</dd>
                  </>
                )}
              </>
            ) : (
              <>
                <dt>Area</dt>
                <dd>{a.details.area}</dd>
                <dt>Delivers by</dt>
                <dd>{VEHICLE_LABEL[a.details.vehicleType]}</dd>
              </>
            )}
            <dt>Applied</dt>
            <dd>{dateTime(a.createdAt)}</dd>
          </dl>
          <p className="fine-print">Verify the details (for example by phone) before approving.</p>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={() => setDeciding({ app: a, action: 'approve' })}>
              Approve
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setDeciding({ app: a, action: 'reject' })}>
              Reject
            </button>
          </div>
        </article>
      ))}

      {closed.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 20 }}>
            <h2>Recent decisions</h2>
          </div>
          {closed.map((a) => (
            <article key={a.id} className="card">
              <div className="order-card-head">
                <strong>{a.type === 'seller' ? a.details.businessName : `Courier: ${a.applicant.name}`}</strong>
                <span className={`status-pill ${a.resolution === 'approved' ? 'good' : 'bad'}`}>
                  {a.resolution === 'approved' ? 'Approved' : 'Rejected'}
                </span>
              </div>
              <p className="fine-print" style={{ margin: 0 }}>
                “{a.reason}” — {a.resolvedBy}, {a.closedAt && dateTime(a.closedAt)}
              </p>
            </article>
          ))}
        </>
      )}

      {deciding && (
        <ReasonDialog
          title={deciding.action === 'approve' ? 'Approve this application?' : 'Reject this application?'}
          description={
            deciding.action === 'approve'
              ? deciding.app.type === 'seller'
                ? `${deciding.app.applicant.name} becomes a seller and “${deciding.app.details.businessName}” is created.`
                : `${deciding.app.applicant.name} becomes a courier and can take delivery jobs.`
              : `${deciding.app.applicant.name} will see your reason and can apply again later.`
          }
          confirmLabel={deciding.action === 'approve' ? 'Approve' : 'Reject'}
          danger={deciding.action === 'reject'}
          onClose={() => setDeciding(null)}
          onConfirm={async (reason) => {
            await api(`/support/applications/${deciding.app.id}/${deciding.action}`, { method: 'POST', body: { reason } })
            setDeciding(null)
            load()
          }}
        />
      )}
    </>
  )
}
