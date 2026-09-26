import { useCallback, useEffect, useState } from 'react'
import { ReasonDialog } from '../../components/ReasonDialog'
import { api, ApiError } from '../../lib/api'
import { dateTime } from '../../lib/labels'
import { formatRand, parseRandToCents } from '../../lib/money'

interface Payment {
  id: number
  status: 'paid' | 'unapplied' | 'refunded'
  amountCents: number
  providerReference: string
  refundedCents: number
  pendingCents: number
  refundableCents: number
}

interface Refund {
  id: number
  paymentId: number
  purpose: 'unapplied_capture' | 'order_refund'
  amountCents: number
  status: 'pending' | 'succeeded' | 'failed'
  providerReference: string | null
  reason: string
  requestedAt: string
}

interface MoneyCase {
  id: number
  type: 'refund' | 'cash_dispute'
  status: 'open' | 'closed'
  details: { why?: string }
  createdAt: string
  closedAt: string | null
  resolution: string | null
  reason: string | null
  resolvedBy: string | null
  order: { id: number; number: string; status: string; totalCents: number; businessName: string; customerName: string }
  payments?: Payment[]
  refunds?: Refund[]
  cash?: { collectedCents: number; remittedCents: number; status: string; courierName: string }
  notes: { text: string; at: string; by: string }[]
}

// Every action a dialog can perform on a money case.
type Action =
  | { kind: 'refund'; c: MoneyCase; p: Payment }
  | { kind: 'complete'; r: Refund }
  | { kind: 'fail'; r: Refund }
  | { kind: 'close'; c: MoneyCase }
  | { kind: 'settle'; c: MoneyCase }
  | { kind: 'note'; c: MoneyCase }

const WHY: Record<string, string> = {
  late_payment: 'Payment arrived after the order had expired',
  second_payment: 'Customer paid twice for the same order',
  order_cancelled: 'Order was cancelled by support after payment',
  customer_problem: 'Customer’s problem with the order was upheld',
}

const PAYMENT_LABEL: Record<Payment['status'], string> = {
  paid: 'Applied to the order',
  unapplied: 'Not applied – must be refunded',
  refunded: 'Refunded in full',
}

// Money exceptions (spec FR-16, BR-08, BR-11). The server enforces every rule again:
// the refund cap, evidence for completed refunds, and no write-off of missing cash.
export function MoneyTab() {
  const [cases, setCases] = useState<MoneyCase[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<Action | null>(null)

  const load = useCallback(() => {
    api<MoneyCase[]>('/support/money/cases')
      .then(setCases)
      .catch((err) => setError(err.message))
  }, [])
  useEffect(load, [load])

  if (!cases) return error ? <p className="notice error">{error}</p> : <div className="skeleton" style={{ minHeight: 200 }} />

  const open = cases.filter((c) => c.status === 'open')
  const closed = cases.filter((c) => c.status === 'closed')
  const done = () => {
    setAction(null)
    load()
  }

  return (
    <>
      <div className="section-head">
        <h2>Open money cases</h2>
      </div>
      {open.length === 0 && <p className="notice">Nothing to resolve.</p>}
      {open.map((c) => (
        <article key={c.id} className="card">
          <CaseHeader c={c} />
          {c.type === 'refund' ? <RefundBody c={c} onAction={setAction} /> : <CashBody c={c} />}
          <Notes c={c} />
          <div className="btn-row" style={{ marginTop: 10 }}>
            {c.type === 'refund' ? (
              <button type="button" className="btn btn-outline" onClick={() => setAction({ kind: 'close', c })}>
                Close case
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => setAction({ kind: 'settle', c })}>
                Rest handed over
              </button>
            )}
            <button type="button" className="btn btn-outline" onClick={() => setAction({ kind: 'note', c })}>
              Add a note
            </button>
          </div>
        </article>
      ))}

      {closed.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 20 }}>
            <h2>Recently resolved</h2>
          </div>
          {closed.map((c) => (
            <article key={c.id} className="card">
              <CaseHeader c={c} />
              <p className="fine-print" style={{ margin: 0 }}>
                “{c.reason}” — {c.resolvedBy}, {c.closedAt && dateTime(c.closedAt)}
              </p>
            </article>
          ))}
        </>
      )}

      {action && <ActionDialog action={action} onClose={() => setAction(null)} onDone={done} />}
    </>
  )
}

function CaseHeader({ c }: { c: MoneyCase }) {
  return (
    <>
      <div className="order-card-head">
        <strong>Order {c.order.number}</strong>
        <span className={`status-pill ${c.status === 'open' ? 'wait' : 'good'}`}>
          {c.type === 'refund' ? 'Refund' : 'Cash short'}
        </span>
      </div>
      <p className="product-meta" style={{ margin: '2px 0 8px' }}>
        {c.order.businessName} · customer {c.order.customerName} · opened {dateTime(c.createdAt)}
      </p>
    </>
  )
}

function RefundBody({ c, onAction }: { c: MoneyCase; onAction: (a: Action) => void }) {
  return (
    <>
      {c.details.why && <p style={{ margin: '0 0 8px' }}>{WHY[c.details.why] ?? c.details.why}.</p>}
      {c.payments!.map((p) => (
        <div key={p.id} className="money-row">
          <div>
            <strong translate="no">{formatRand(p.amountCents)}</strong> · {PAYMENT_LABEL[p.status]}
            <div className="product-meta">
              Payfast {p.providerReference}
              {p.refundedCents > 0 && ` · refunded ${formatRand(p.refundedCents)}`}
              {p.pendingCents > 0 && ` · ${formatRand(p.pendingCents)} pending`}
            </div>
          </div>
          {p.refundableCents > 0 && (
            <button type="button" className="link-btn" onClick={() => onAction({ kind: 'refund', c, p })}>
              Refund…
            </button>
          )}
        </div>
      ))}
      {c.refunds!.length > 0 && (
        <ul className="refund-list">
          {c.refunds!.map((r) => (
            <li key={r.id}>
              <span>
                Refund {formatRand(r.amountCents)} ·{' '}
                {r.status === 'pending' ? 'waiting for Payfast' : r.status === 'succeeded' ? `done (${r.providerReference})` : 'failed'}
              </span>
              {r.status === 'pending' && (
                <span className="refund-actions">
                  <button type="button" className="link-btn" onClick={() => onAction({ kind: 'complete', r })}>
                    Payfast confirmed
                  </button>
                  <button type="button" className="link-btn" onClick={() => onAction({ kind: 'fail', r })}>
                    Failed
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function CashBody({ c }: { c: MoneyCase }) {
  const k = c.cash!
  return (
    <dl className="details">
      <dt>Courier collected</dt>
      <dd translate="no">{formatRand(k.collectedCents)} ({k.courierName})</dd>
      <dt>Seller received</dt>
      <dd translate="no">{formatRand(k.remittedCents)}</dd>
      <dt>Missing</dt>
      <dd translate="no">
        <strong>{formatRand(k.collectedCents - k.remittedCents)}</strong>
      </dd>
    </dl>
  )
}

function Notes({ c }: { c: MoneyCase }) {
  if (c.notes.length === 0) return null
  return (
    <ul className="case-notes">
      {c.notes.map((n, i) => (
        <li key={i}>
          “{n.text}” <span className="product-meta">— {n.by}, {dateTime(n.at)}</span>
        </li>
      ))}
    </ul>
  )
}

function ActionDialog({ action, onClose, onDone }: { action: Action; onClose: () => void; onDone: () => void }) {
  const post = async (path: string, body: unknown) => {
    await api(`/support/money${path}`, { method: 'POST', body })
    onDone()
  }

  switch (action.kind) {
    case 'refund':
      return (
        <ReasonDialog
          title="Start a refund"
          description={`Up to ${formatRand(action.p.refundableCents)} of this payment can still be refunded. After saving, do the refund in the Payfast dashboard, then tap “Payfast confirmed”.`}
          field={{ label: 'Amount (R)', initial: (action.p.refundableCents / 100).toFixed(2), inputMode: 'decimal' }}
          confirmLabel="Start refund"
          onClose={onClose}
          onConfirm={async (reason, amount) => {
            const cents = parseRandToCents(amount)
            if (!cents) throw new ApiError(422, 'Enter an amount, e.g. 25.00.')
            await post(`/refund-cases/${action.c.id}/refunds`, { paymentId: action.p.id, amountCents: cents, reason })
          }}
        />
      )
    case 'complete':
      return (
        <ReasonDialog
          title="Payfast confirmed the refund"
          description={`Refund of ${formatRand(action.r.amountCents)}. Copy the refund reference from the Payfast dashboard as evidence.`}
          field={{ label: 'Payfast refund reference' }}
          askReason={false}
          confirmLabel="Mark as refunded"
          onClose={onClose}
          onConfirm={(_reason, reference) => post(`/refunds/${action.r.id}/complete`, { providerReference: reference })}
        />
      )
    case 'fail':
      return (
        <ReasonDialog
          title="Refund didn’t go through"
          description="The amount becomes refundable again, so you can try once more."
          confirmLabel="Mark as failed"
          danger
          onClose={onClose}
          onConfirm={(reason) => post(`/refunds/${action.r.id}/fail`, { reason })}
        />
      )
    case 'close':
      return (
        <ReasonDialog
          title="Close this case?"
          description="Only possible when no refund is pending and any money never applied to the order has been returned in full."
          confirmLabel="Close case"
          onClose={onClose}
          onConfirm={(reason) => post(`/refund-cases/${action.c.id}/close`, { reason })}
        />
      )
    case 'settle':
      return (
        <ReasonDialog
          title="The missing cash was handed over"
          description="Confirm with the seller first. The cash record becomes fully handed over and the case closes."
          confirmLabel="Confirm"
          onClose={onClose}
          onConfirm={(reason) => post(`/cash-cases/${action.c.id}/settle`, { reason })}
        />
      )
    case 'note':
      return (
        <ReasonDialog
          title="Add a note"
          description="What you checked or who you spoke to. Notes can’t be edited later."
          confirmLabel="Save note"
          onClose={onClose}
          onConfirm={(note) => post(`/cases/${action.c.id}/notes`, { reason: note })}
        />
      )
  }
}
