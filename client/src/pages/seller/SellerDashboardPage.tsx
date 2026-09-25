import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { formatRand } from '../../lib/money'
import type { Kpis, SellerOrder } from '../../lib/types'

interface Dashboard {
  business: { id: number; name: string }
  period: string
  asOf: string
  kpis: Kpis
}

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
]

const DECLINE_REASONS = ['Out of stock', 'Closed right now', "Can't prepare it in time"]
const REFRESH_MS = 20_000 // check for new orders every 20 seconds

function minutesLeft(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000))
}

function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' })
}

export function SellerDashboardPage() {
  const [period, setPeriod] = useState('week')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [orders, setOrders] = useState<SellerOrder[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([api<Dashboard>(`/seller/dashboard?period=${period}`), api<SellerOrder[]>('/seller/orders')])
      .then(([d, o]) => {
        setDashboard(d)
        setOrders(o)
        setError(null)
      })
      .catch((err) => setError(err.message))
  }, [period])

  useEffect(() => {
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  if (error && !dashboard) {
    return (
      <main className="page">
        <p className="notice error" role="alert">
          {error}
        </p>
      </main>
    )
  }
  if (!dashboard || !orders) {
    return (
      <main className="page">
        <div className="skeleton" style={{ minHeight: 300 }} aria-busy="true" />
      </main>
    )
  }

  const k = dashboard.kpis
  const waiting = orders.filter((o) => o.status === 'pending_acceptance')
  const active = orders.filter((o) => ['awaiting_payment', 'confirmed', 'ready', 'out_for_delivery'].includes(o.status))
  const recent = orders.filter((o) => ['completed', 'declined', 'cancelled', 'expired'].includes(o.status))

  return (
    <main className="page seller">
      <p className="eyebrow">Your business</p>
      <h1 className="page-title" style={{ marginTop: 0 }}>
        {dashboard.business.name}
      </h1>

      <div className="chips" role="group" aria-label="Report period" style={{ marginBottom: 12 }}>
        {PERIODS.map((p) => (
          <button key={p.key} type="button" className="chip" aria-pressed={period === p.key} onClick={() => setPeriod(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      <section className="kpi-grid" aria-label="Your numbers">
        <Kpi label="New orders" value={String(k.pendingOrders)} accent={k.pendingOrders > 0} />
        <Kpi label="Delivered value" value={formatRand(k.grossDeliveredCents)} hint={`${k.completedOrders} completed`} />
        <Kpi
          label="Cash still to reach you"
          value={formatRand(k.unreconciledCashCents)}
          accent={k.unreconciledCashCents > 0}
        />
        <Kpi label="Low stock items" value={String(k.lowStockProducts)} accent={k.lowStockProducts > 0} link="/seller/products" />
      </section>
      <p className="fine-print">
        Accepted: {k.acceptanceRate === null ? 'N/A' : `${Math.round(k.acceptanceRate * 100)}%`} · Average order:{' '}
        {k.averageCompletedCents === null ? 'N/A' : formatRand(Math.round(k.averageCompletedCents))} · Delivered value
        is products only (no delivery fees), not profit. As of {timeOfDay(dashboard.asOf)}.
      </p>
      <Link to="/seller/products" className="btn btn-outline btn-block" style={{ marginTop: 12 }}>
        Your products and stock
      </Link>

      {error && (
        <p className="notice error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}

      <section aria-labelledby="waiting-heading" style={{ marginTop: 20 }}>
        <div className="section-head">
          <h2 id="waiting-heading">Waiting for you</h2>
          <span className="urgent">Reply within 30 min</span>
        </div>
        {waiting.length === 0 ? (
          <p className="notice">No new orders right now. New orders appear here automatically.</p>
        ) : (
          waiting.map((o) => <OrderCard key={o.id} order={o} onChanged={load} />)
        )}
      </section>

      {active.length > 0 && (
        <section aria-labelledby="active-heading" style={{ marginTop: 20 }}>
          <div className="section-head">
            <h2 id="active-heading">In progress</h2>
          </div>
          {active.map((o) => (
            <OrderCard key={o.id} order={o} onChanged={load} />
          ))}
        </section>
      )}

      {recent.length > 0 && (
        <section aria-labelledby="recent-heading" style={{ marginTop: 20 }}>
          <div className="section-head">
            <h2 id="recent-heading">Recent</h2>
          </div>
          {recent.map((o) => (
            <OrderCard key={o.id} order={o} onChanged={load} />
          ))}
        </section>
      )}

      <div className="sticky-action">
        <Link to="/seller/products/new" className="btn btn-dark btn-block">
          + Add a product
        </Link>
      </div>
    </main>
  )
}

function Kpi({ label, value, hint, accent, link }: { label: string; value: string; hint?: string; accent?: boolean; link?: string }) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value${accent ? ' accent' : ''}`} translate="no">
        {value}
      </span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </>
  )
  return link ? (
    <Link to={link} className="kpi">
      {body}
    </Link>
  ) : (
    <div className="kpi">{body}</div>
  )
}

const PILL: Record<string, { label: string; tone: string }> = {
  pending_acceptance: { label: 'New', tone: 'new' },
  awaiting_payment: { label: 'Waiting for payment', tone: 'wait' },
  confirmed: { label: 'Confirmed', tone: 'good' },
  ready: { label: 'Ready', tone: 'good' },
  out_for_delivery: { label: 'With courier', tone: 'good' },
  completed: { label: 'Completed', tone: 'good' },
  declined: { label: 'Declined', tone: 'bad' },
  cancelled: { label: 'Cancelled by customer', tone: 'bad' },
  expired: { label: 'Expired', tone: 'bad' },
}

function OrderCard({ order: o, onChanged }: { order: SellerOrder; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [otherReason, setOtherReason] = useState('')
  const [code, setCode] = useState('')
  const pill = PILL[o.status] ?? { label: o.status, tone: 'wait' }

  async function act(path: string, body?: unknown) {
    setBusy(true)
    setError(null)
    try {
      await api(`/seller/orders/${o.id}/${path}`, { method: 'POST', body: body ?? {} })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      // A conflict means the order changed elsewhere (cancelled, expired...) - show the latest.
      if (err instanceof ApiError && err.status === 409) onChanged()
    } finally {
      setBusy(false)
    }
  }

  const finalReason = reason === 'Other' ? otherReason.trim() : reason

  return (
    <article className="card order-card">
      <div className="order-card-head">
        <strong translate="no">Order {o.orderNumber}</strong>
        <span className={`status-pill ${pill.tone}`}>{pill.label}</span>
      </div>
      <p className="order-card-items">
        {o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}
      </p>
      <p className="product-meta" style={{ margin: 0 }}>
        {o.customerName} · {o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'} · {o.paymentMethod === 'cash' ? 'Cash' : 'Online'} ·{' '}
        <span className="price" translate="no">
          {formatRand(o.totalCents)}
        </span>
      </p>
      {o.notes && <p className="fine-print">Note: {o.notes}</p>}

      {o.status === 'pending_acceptance' && !declining && (
        <>
          <p className="fine-print urgent">{minutesLeft(o.acceptBy)} min left to reply</p>
          <div className="btn-row">
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setDeclining(true)}>
              Decline
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('accept')}>
              {busy ? 'Accepting…' : 'Accept'}
            </button>
          </div>
        </>
      )}

      {o.status === 'pending_acceptance' && declining && (
        <fieldset className="choice-group" style={{ marginTop: 12 }}>
          <legend>Why can’t you take this order? The customer will see this.</legend>
          <div className="reason-list">
            {[...DECLINE_REASONS, 'Other'].map((r) => (
              <label key={r} className="choice">
                <input type="radio" name={`reason-${o.id}`} checked={reason === r} onChange={() => setReason(r)} />
                {r}
              </label>
            ))}
          </div>
          {reason === 'Other' && (
            <div className="input-wrap" style={{ marginTop: 8 }}>
              <label className="visually-hidden" htmlFor={`other-${o.id}`}>
                Reason
              </label>
              <input
                id={`other-${o.id}`}
                value={otherReason}
                onChange={(e) => setOtherReason(e.target.value)}
                maxLength={200}
                placeholder="Type a short reason"
              />
            </div>
          )}
          <div className="btn-row">
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setDeclining(false)}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || finalReason.length < 3}
              onClick={() => act('decline', { reason: finalReason })}
            >
              Decline order
            </button>
          </div>
        </fieldset>
      )}

      {o.status === 'confirmed' && (
        <button type="button" className="btn btn-outline btn-block" style={{ marginTop: 12 }} disabled={busy} onClick={() => act('ready')}>
          {busy ? 'Saving…' : 'Mark as ready'}
        </button>
      )}

      {o.status === 'ready' && o.fulfilment === 'pickup' && (
        <form
          className="pickup-form"
          onSubmit={(e) => {
            e.preventDefault()
            act('pickup', { code })
          }}
        >
          <label htmlFor={`code-${o.id}`}>Customer’s collection code</label>
          <p className="fine-print" style={{ marginTop: 0 }}>
            Ask to see the 6-digit code in their Orders screen.
            {o.paymentMethod === 'cash' && (
              <>
                {' '}
                Collect <strong translate="no">{formatRand(o.totalCents)}</strong> cash.
              </>
            )}
          </p>
          <div className="btn-row">
            <div className="input-wrap">
              <input
                id={`code-${o.id}`}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="code-input"
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Complete pickup'}
            </button>
          </div>
        </form>
      )}

      {o.status === 'ready' && o.fulfilment === 'delivery' && (
        <p className="fine-print">Waiting for a courier to collect it.</p>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </article>
  )
}
