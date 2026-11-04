import { Fragment, useCallback, useEffect, useState } from 'react'
import { ReasonDialog } from '../../components/ReasonDialog'
import { api } from '../../lib/api'
import { DOCUMENT_LABEL } from '../../lib/documents'
import { VEHICLE_LABEL, dateTime, localPhone } from '../../lib/labels'

interface TrailItem {
  kind: 'email' | 'note'
  subject: string | null
  body: string
  status: 'sent' | 'failed' | null
  by: string | null
  at: string
}

const MOTORISED = ['motorbike', 'car', 'bakkie']

// The documents this application should have (the same rule as the server's).
function expectedDocuments(a: { type: 'seller' | 'courier' | 'documents'; details: Record<string, string>; documents: string[] }): string[] {
  if (a.type === 'documents') return a.documents
  if (a.type === 'seller') return ['id_document']
  return MOTORISED.includes(a.details.vehicleType) ? ['id_document', 'drivers_licence', 'police_clearance'] : ['id_document', 'police_clearance']
}

// The card's heading: the business, the courier, or whose documents these are.
function title(a: Application): string {
  if (a.type === 'seller') return a.details.businessName
  return a.type === 'courier' ? `Courier: ${a.applicant.name}` : `Courier documents: ${a.applicant.name}`
}

interface Application {
  id: number
  type: 'seller' | 'courier' | 'documents' // documents: a courier's documents sent after approval
  status: 'open' | 'closed'
  applicant: { name: string; phone: string }
  details: Record<string, string>
  documents: string[] // e.g. ['id_document', 'drivers_licence', 'police_clearance']
  trail: TrailItem[]
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
  const [emailing, setEmailing] = useState<Application | null>(null)

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
            <strong>{title(a)}</strong>
            <span className="status-pill">{a.type === 'seller' ? 'Wants to sell' : a.type === 'courier' ? 'Wants to deliver' : 'Documents to check'}</span>
          </div>
          <dl className="details">
            <dt>{a.type === 'documents' ? 'Courier' : 'Applicant'}</dt>
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
                {a.details.area && (
                  <>
                    <dt>Area</dt>
                    <dd>{a.details.area}</dd>
                  </>
                )}
                <dt>Delivers by</dt>
                <dd>{VEHICLE_LABEL[a.details.vehicleType]}</dd>
              </>
            )}
            {a.details.email && (
              <>
                <dt>Email</dt>
                <dd translate="no">{a.details.email}</dd>
              </>
            )}
            {expectedDocuments(a).map((kind) => (
              <Fragment key={kind}>
                <dt>{DOCUMENT_LABEL[kind]}</dt>
                <dd>
                  {kind === 'police_clearance' && a.details.policeClearance === 'applied' && (
                    <span className="product-meta">Proof of applying – certificate due 30 days after approval. </span>
                  )}
                  {a.documents.includes(kind) ? (
                    // Opens in a new tab; the server records every opening in the audit log.
                    <a href={`/api/support/applications/${a.id}/documents/${kind}`} target="_blank" rel="noopener noreferrer">
                      Open
                    </a>
                  ) : (
                    'Not uploaded (applied before document checks started)'
                  )}
                </dd>
              </Fragment>
            ))}
            {a.details.agreedAt && (
              <>
                <dt>Agreed to</dt>
                <dd>
                  {a.type === 'seller' ? 'Seller' : 'Courier'} terms ({a.details.termsVersion}) and privacy notice (
                  {a.details.privacyVersion}), {dateTime(a.details.agreedAt)}
                </dd>
              </>
            )}
            <dt>{a.type === 'documents' ? 'Sent' : 'Applied'}</dt>
            <dd>{dateTime(a.createdAt)}</dd>
          </dl>
          <p className="fine-print">
            {a.type === 'seller'
              ? 'Check that the name on the ID document matches the applicant, and verify the details (for example by phone) before approving.'
              : a.type === 'documents'
                ? 'An approved courier sent these. Check that each one is in their name and still valid, and that a police clearance shows no record that puts customers at risk.'
                : 'Check that the ID, licence and police clearance are all in the applicant’s name, the licence is valid and covers their vehicle, and the clearance shows no record that puts customers at risk.'}{' '}
            Opening a document is recorded.
          </p>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={() => setDeciding({ app: a, action: 'approve' })}>
              {a.type === 'documents' ? 'Verified' : 'Approve'}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setDeciding({ app: a, action: 'reject' })}>
              Reject
            </button>
          </div>
          {a.details.email && (
            <button type="button" className="btn btn-outline btn-block" style={{ marginTop: 10 }} onClick={() => setEmailing(a)}>
              Email the applicant
            </button>
          )}
          <Trail items={a.trail} />
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
                <strong>{title(a)}</strong>
                <span className={`status-pill ${a.resolution === 'approved' ? 'good' : 'bad'}`}>
                  {a.resolution === 'approved' ? 'Approved' : 'Rejected'}
                </span>
              </div>
              <p className="fine-print" style={{ margin: 0 }}>
                “{a.reason}” — {a.resolvedBy}, {a.closedAt && dateTime(a.closedAt)}
              </p>
              <Trail items={a.trail} />
            </article>
          ))}
        </>
      )}

      {emailing && (
        <ReasonDialog
          title="Email the applicant"
          description={`Goes to ${emailing.details.email}. Their reply comes to the admin's own inbox, and this email is kept with the application. Never ask for an ID document by email: ask them to upload a new one under Profile.`}
          reasonLabel="Your message"
          maxLength={2000}
          confirmLabel="Send email"
          onClose={() => setEmailing(null)}
          onConfirm={async (message) => {
            await api(`/support/applications/${emailing.id}/email`, { method: 'POST', body: { message } })
            setEmailing(null)
            load()
          }}
        />
      )}

      {deciding && (
        <ReasonDialog
          title={
            deciding.app.type === 'documents'
              ? deciding.action === 'approve'
                ? 'Documents checked and valid?'
                : 'Reject these documents?'
              : deciding.action === 'approve'
                ? 'Approve this application?'
                : 'Reject this application?'
          }
          description={
            deciding.app.type === 'documents'
              ? deciding.action === 'approve'
                ? `They are no longer outstanding for ${deciding.app.applicant.name}, who can take jobs again if they were overdue.`
                : `${deciding.app.applicant.name} sees your reason and sends them again.`
              : deciding.action === 'approve'
                ? deciding.app.type === 'seller'
                  ? `${deciding.app.applicant.name} becomes a seller and “${deciding.app.details.businessName}” is created.`
                  : `${deciding.app.applicant.name} becomes a courier and can take delivery jobs.`
                : `${deciding.app.applicant.name} will see your reason and can apply again later.`
          }
          confirmLabel={deciding.action === 'approve' ? (deciding.app.type === 'documents' ? 'Verified' : 'Approve') : 'Reject'}
          danger={deciding.action === 'reject'}
          onClose={() => setDeciding(null)}
          onConfirm={async (reason) => {
            const path =
              deciding.app.type === 'documents'
                ? `/support/courier-documents/${deciding.app.id}/${deciding.action === 'approve' ? 'verify' : 'reject'}`
                : `/support/applications/${deciding.app.id}/${deciding.action}`
            await api(path, { method: 'POST', body: { reason } })
            setDeciding(null)
            load()
          }}
        />
      )}
    </>
  )
}

// What was said to the applicant and what they changed, oldest first - so anyone in support can see
// the whole conversation before deciding. (Their email replies are in the admin's inbox.)
function Trail({ items }: { items: TrailItem[] }) {
  if (items.length === 0) return null
  return (
    <details className="trail">
      <summary>Emails and changes ({items.length})</summary>
      <ul>
        {items.map((t, i) => (
          <li key={i}>
            <span className="product-meta">
              {dateTime(t.at)} ·{' '}
              {t.kind === 'email'
                ? `Email from ${t.by ?? 'the site'}${t.status === 'failed' ? ' (NOT delivered - check the address)' : ''}`
                : t.by ?? 'Applicant'}
            </span>
            {t.subject && <strong>{t.subject}</strong>}
            <p>{t.body}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}
