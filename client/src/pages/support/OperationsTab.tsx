import { useCallback, useEffect, useState } from 'react'
import { ReasonDialog } from '../../components/ReasonDialog'
import { api, ApiError } from '../../lib/api'
import { dateTime, localPhone } from '../../lib/labels'
import { formatRand } from '../../lib/money'

interface OpsCase {
  id: number
  type: 'fulfilment' | 'order_problem'
  status: 'open' | 'closed'
  details: { why?: 'delivery_failed' | 'no_courier'; reason?: string; description?: string }
  createdAt: string
  closedAt: string | null
  resolution: string | null
  reason: string | null
  resolvedBy: string | null
  order: {
    id: number
    number: string
    status: string
    fulfilment: string
    paymentMethod: string
    paidOnline: boolean
    totalCents: number
    businessName: string
    customerName: string
    items: { name: string; quantity: number }[]
  }
  delivery: { status: string; courierName: string | null; failedReason: string | null } | null
  notes: { text: string; at: string; by: string }[]
}

interface Contacts {
  customer: { name: string; phone: string; address: string | null }
  business: { name: string; phone: string }
  courier: { name: string; phone: string } | null
}

type ActionKind = 'retry' | 'cancel-order' | 'refund' | 'close' | 'note'

const FAIL_TEXT: Record<string, string> = {
  customer_absent: 'nobody was there',
  wrong_address: 'the address couldn’t be found',
  customer_refused: 'the customer refused it',
  no_payment: 'the cash couldn’t be collected',
}

function title(c: OpsCase): string {
  if (c.type === 'order_problem') return 'Customer reported a problem'
  if (c.details.why === 'no_courier') return 'No courier took the job (30 min)'
  return `Not delivered: ${FAIL_TEXT[c.details.reason ?? ''] ?? 'delivery failed'}`
}

// Delivery and order problems (spec FR-15, FR-16, BR-10). Scope "operations".
export function OperationsTab() {
  const [cases, setCases] = useState<OpsCase[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<{ kind: ActionKind; c: OpsCase } | null>(null)
  const [contacts, setContacts] = useState<Record<number, Contacts>>({})
  const [failedNotes, setFailedNotes] = useState(0)
  const [retrying, setRetrying] = useState(false)

  const load = useCallback(() => {
    api<OpsCase[]>('/support/ops/cases')
      .then(setCases)
      .catch((err) => setError(err.message))
    // Notifications the worker gave up on (spec Table 79: visible dead letters).
    api<unknown[]>('/support/ops/outbox')
      .then((list) => setFailedNotes(list.length))
      .catch(() => {})
  }, [])
  useEffect(load, [load])

  // Phone numbers only on request - and the server writes each request to the audit log.
  async function showContacts(c: OpsCase) {
    try {
      const r = await api<Contacts>(`/support/ops/cases/${c.id}/contacts`, { method: 'POST' })
      setContacts((all) => ({ ...all, [c.id]: r }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load contact details.')
    }
  }

  if (!cases) return error ? <p className="notice error">{error}</p> : <div className="skeleton" style={{ minHeight: 200 }} />

  const open = cases.filter((c) => c.status === 'open')
  const closed = cases.filter((c) => c.status === 'closed')

  return (
    <>
      {error && <p className="notice error">{error}</p>}
      {failedNotes > 0 && (
        <div className="notice error" style={{ marginBottom: 12 }}>
          <strong>{failedNotes} notification(s) couldn’t be sent</strong> after 5 tries. The orders are fine; only the
          messages are stuck.{' '}
          <button type="button" className="link-btn" onClick={() => setRetrying(true)}>
            Retry
          </button>
        </div>
      )}
      {retrying && (
        <ReasonDialog
          title="Retry failed notifications?"
          description="They go back into the queue and the worker tries again within a few seconds."
          confirmLabel="Retry"
          onClose={() => setRetrying(false)}
          onConfirm={async (reason) => {
            await api('/support/ops/outbox/retry', { method: 'POST', body: { reason } })
            setRetrying(false)
            load()
          }}
        />
      )}
      <div className="section-head">
        <h2>Open delivery cases</h2>
      </div>
      {open.length === 0 && <p className="notice">Nothing to resolve.</p>}
      {open.map((c) => {
        const failed = c.order.status === 'delivery_failed'
        const cancellable = c.type === 'fulfilment' && (failed || c.order.status === 'ready')
        const k = contacts[c.id]
        return (
          <article key={c.id} className="card">
            <div className="order-card-head">
              <strong>Order {c.order.number}</strong>
              <span className="status-pill wait">{c.type === 'order_problem' ? 'Problem' : 'Delivery'}</span>
            </div>
            <p style={{ margin: '4px 0' }}>
              <strong>{title(c)}</strong>
            </p>
            {c.details.description && <p style={{ margin: '4px 0' }}>“{c.details.description}”</p>}
            <p className="product-meta" style={{ margin: '2px 0 8px' }}>
              {c.order.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')} · {formatRand(c.order.totalCents)} ·{' '}
              {c.order.paidOnline ? 'paid online' : c.order.paymentMethod === 'cash' ? 'cash' : 'not paid'} ·{' '}
              {c.order.businessName} · customer {c.order.customerName}
              {c.delivery?.courierName && ` · courier ${c.delivery.courierName}`} · opened {dateTime(c.createdAt)}
            </p>

            {k ? (
              <dl className="details">
                <dt>Customer</dt>
                <dd translate="no">
                  <a href={`tel:${k.customer.phone}`}>{localPhone(k.customer.phone)}</a>
                  {k.customer.address && ` · ${k.customer.address}`}
                </dd>
                <dt>Seller</dt>
                <dd translate="no">
                  <a href={`tel:${k.business.phone}`}>{localPhone(k.business.phone)}</a>
                </dd>
                {k.courier && (
                  <>
                    <dt>Courier</dt>
                    <dd translate="no">
                      <a href={`tel:${k.courier.phone}`}>{localPhone(k.courier.phone)}</a>
                    </dd>
                  </>
                )}
              </dl>
            ) : (
              <button type="button" className="link-btn" onClick={() => showContacts(c)}>
                Show contact details (recorded in the audit log)
              </button>
            )}

            {c.notes.length > 0 && (
              <ul className="case-notes">
                {c.notes.map((n, i) => (
                  <li key={i}>
                    “{n.text}” <span className="product-meta">— {n.by}, {dateTime(n.at)}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="btn-row" style={{ marginTop: 10 }}>
              {failed && (
                <button type="button" className="btn btn-primary" onClick={() => setAction({ kind: 'retry', c })}>
                  Deliver again
                </button>
              )}
              {cancellable && (
                <button type="button" className="btn btn-outline" onClick={() => setAction({ kind: 'cancel-order', c })}>
                  Cancel order
                </button>
              )}
              {c.type === 'order_problem' && (
                <button type="button" className="btn btn-primary" onClick={() => setAction({ kind: 'refund', c })}>
                  Refund customer
                </button>
              )}
              {!failed && (
                <button type="button" className="btn btn-outline" onClick={() => setAction({ kind: 'close', c })}>
                  Close case
                </button>
              )}
              <button type="button" className="btn btn-outline" onClick={() => setAction({ kind: 'note', c })}>
                Add a note
              </button>
            </div>
          </article>
        )
      })}

      {closed.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 20 }}>
            <h2>Recently resolved</h2>
          </div>
          {closed.map((c) => (
            <article key={c.id} className="card">
              <div className="order-card-head">
                <strong>Order {c.order.number}</strong>
                <span className="status-pill good">{c.resolution}</span>
              </div>
              <p className="fine-print" style={{ margin: 0 }}>
                {title(c)} — “{c.reason}” — {c.resolvedBy}, {c.closedAt && dateTime(c.closedAt)}
              </p>
            </article>
          ))}
        </>
      )}

      {action && (
        <ReasonDialog
          {...DIALOG[action.kind](action.c)}
          onClose={() => setAction(null)}
          onConfirm={async (reason) => {
            const path = action.kind === 'note' ? 'notes' : action.kind
            await api(`/support/ops/cases/${action.c.id}/${path}`, { method: 'POST', body: { reason } })
            setAction(null)
            load()
          }}
        />
      )}
    </>
  )
}

// Wording for each decision, so staff know exactly what will happen before they confirm.
const DIALOG: Record<ActionKind, (c: OpsCase) => { title: string; description: string; confirmLabel: string; danger?: boolean }> = {
  retry: () => ({
    title: 'Deliver again?',
    description: 'The same courier tries again (agree a time with the customer first). The customer can show a new code.',
    confirmLabel: 'Deliver again',
  }),
  'cancel-order': (c) => ({
    title: 'Cancel this order?',
    description:
      (c.order.status === 'ready'
        ? 'The held stock is released and the delivery job disappears.'
        : 'The courier brings the goods back and the seller checks them before restocking.') +
      (c.order.paidOnline ? ' A refund case opens for the payments team.' : ''),
    confirmLabel: 'Cancel order',
    danger: true,
  }),
  refund: (c) => ({
    title: 'Refund the customer?',
    description: c.order.paidOnline
      ? 'A refund case opens in the Money queue, where the refund is done and recorded with Payfast’s reference.'
      : 'This order was paid in cash. Arrange a cash return with the seller and record it in a note instead.',
    confirmLabel: 'Open refund case',
  }),
  close: () => ({
    title: 'Close this case?',
    description: 'For example: a courier took the job after all, or the problem was sorted out without a refund.',
    confirmLabel: 'Close case',
  }),
  note: () => ({
    title: 'Add a note',
    description: 'What you checked or who you spoke to. Notes can’t be edited later.',
    confirmLabel: 'Save note',
  }),
}
