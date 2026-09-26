import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { MokalaSmall } from '../components/Art'
import { api, ApiError } from '../lib/api'
import { formatRand } from '../lib/money'

interface OrderSummary {
  id: number
  orderNumber: string
  status: string
  fulfilment: 'pickup' | 'delivery'
  paymentMethod: 'cash' | 'online'
  totalCents: number
  acceptBy: string
  createdAt: string
  businessName: string
  businessArea: string
  courierName: string | null
  paymentDueAt: string | null
  paymentStatus: 'pending' | 'paid' | 'unapplied' | 'failed' | 'refunded' | null
  refundedCents: number
  refundPendingCents: number
  statusReason: string | null
  items: { name: string; unitLabel: string; quantity: number }[]
}

// Plain-language status labels (spec 7.1: "Waiting for seller", "Cash still due").
// Each status also has a distinct word, so colour is never the only cue.
const STATUS: Record<string, { label: string; tone: 'wait' | 'good' | 'bad' }> = {
  pending_acceptance: { label: 'Waiting for seller', tone: 'wait' },
  awaiting_payment: { label: 'Accepted – pay now', tone: 'wait' },
  confirmed: { label: 'Accepted', tone: 'good' },
  ready: { label: 'Ready', tone: 'good' },
  out_for_delivery: { label: 'On the way', tone: 'good' },
  completed: { label: 'Completed', tone: 'good' },
  declined: { label: 'Declined by seller', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
  expired: { label: 'Expired', tone: 'bad' },
}

function timeLeft(iso: string): string {
  const mins = Math.ceil((new Date(iso).getTime() - Date.now()) / 60000)
  return mins > 0 ? `seller has ${mins} min left to reply` : 'waiting for the seller'
}

export function OrdersPage() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const placed = (location.state as { placed?: string } | null)?.placed
  // Coming back from Payfast: ?payment=returned or ?payment=cancelled
  const paymentReturn = new URLSearchParams(location.search).get('payment')
  const [orders, setOrders] = useState<OrderSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [codes, setCodes] = useState<Record<number, { code: string; expiresAt: string }>>({})

  const load = useCallback(() => {
    api<OrderSummary[]>('/orders/mine')
      .then(setOrders)
      .catch((err) => setError(err.message))
  }, [])

  // After returning from Payfast we only REFRESH: the browser coming back is not proof of
  // payment (spec 5.5). The order changes only when Payfast's own notification is verified.
  useEffect(() => {
    if (!user || paymentReturn !== 'returned') return
    const t = setInterval(load, 5000)
    const stop = setTimeout(() => clearInterval(t), 120_000)
    return () => {
      clearInterval(t)
      clearTimeout(stop)
    }
  }, [user, paymentReturn, load])

  useEffect(() => {
    if (user) load()
  }, [user, load])

  // Gets a signed checkout form from our server and sends the browser to Payfast with it.
  // Card and bank details are typed on Payfast's page only - never in our app.
  async function payNow(id: number) {
    setBusyId(id)
    setError(null)
    try {
      const checkout = await api<{ action: string; fields: Record<string, string> }>(`/orders/${id}/payment-attempts`, {
        method: 'POST',
      })
      const form = document.createElement('form')
      form.method = 'POST'
      form.action = checkout.action
      for (const [name, value] of Object.entries(checkout.fields)) {
        const input = document.createElement('input')
        input.type = 'hidden'
        input.name = name
        input.value = value
        form.appendChild(input)
      }
      document.body.appendChild(form)
      form.submit()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the payment. Please try again.')
      setBusyId(null)
      load()
    }
  }

  async function cancel(id: number) {
    setBusyId(id)
    setError(null)
    try {
      await api(`/orders/${id}/cancel`, { method: 'POST' })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel. Please try again.')
    } finally {
      setBusyId(null)
      load()
    }
  }

  // Collection code for a ready pickup order. Asking again gives a new code (the old one stops working).
  async function showCode(id: number) {
    setBusyId(id)
    setError(null)
    try {
      const c = await api<{ code: string; expiresAt: string }>(`/orders/${id}/handover-code`, { method: 'POST' })
      setCodes((all) => ({ ...all, [id]: c }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not get a code. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return null

  if (!user) {
    return (
      <main className="page">
        <h1 className="page-title">Your orders</h1>
        <div className="empty">
          <MokalaSmall />
          <h2>Sign in to see your orders</h2>
          <p>Your orders stay private to your account.</p>
          <Link to="/signin" state={{ from: '/orders' }} className="btn btn-primary">
            Sign in
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="page">
      <h1 className="page-title">Your orders</h1>

      {paymentReturn === 'returned' && (
        <p className="notice" role="status" style={{ marginBottom: 12, borderColor: 'var(--primary)' }}>
          <strong>Checking your payment with Payfast…</strong> Your order changes to “Accepted” as soon as Payfast
          confirms it. This page updates by itself.
        </p>
      )}
      {paymentReturn === 'cancelled' && (
        <p className="notice" role="status" style={{ marginBottom: 12 }}>
          Payment cancelled – nothing was charged. You can try again before the time runs out.
        </p>
      )}
      {placed && (
        <p className="notice" role="status" style={{ marginBottom: 12, borderColor: 'var(--primary)' }}>
          <strong>Order {placed} sent.</strong> We’ll show here when the seller accepts it.
        </p>
      )}
      {error && (
        <p className="notice error" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}

      {orders === null ? (
        <div className="skeleton" style={{ minHeight: 120 }} aria-busy="true" />
      ) : orders.length === 0 ? (
        <div className="empty">
          <MokalaSmall />
          <h2>No orders yet</h2>
          <Link to="/" className="btn btn-primary">
            Start shopping
          </Link>
        </div>
      ) : (
        orders.map((o) => {
          const s = STATUS[o.status] ?? { label: o.status, tone: 'wait' as const }
          return (
            <article className="card" key={o.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <strong translate="no">Order {o.orderNumber}</strong>
                <span className={`status-pill ${s.tone}`}>{s.label}</span>
              </div>
              <div className="product-meta" style={{ margin: '4px 0 8px' }}>
                {o.businessName} · {o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'} ·{' '}
                {o.paymentMethod === 'cash' ? 'Cash' : 'Online'}
              </div>
              <div style={{ fontSize: '0.9rem' }}>
                {o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                <span className="price" translate="no">
                  {formatRand(o.totalCents)}
                </span>
                {o.status === 'pending_acceptance' && (
                  <button type="button" className="btn btn-outline" onClick={() => cancel(o.id)} disabled={busyId === o.id}>
                    {busyId === o.id ? 'Cancelling…' : 'Cancel order'}
                  </button>
                )}
              </div>
              {o.status === 'pending_acceptance' && <p className="fine-print">{timeLeft(o.acceptBy)}</p>}
              {o.status === 'expired' && o.statusReason && o.paymentStatus !== 'unapplied' && (
                <p className="fine-print">{o.statusReason}. Nothing was charged and you can order again.</p>
              )}
              {o.status === 'declined' && o.statusReason && (
                <p className="fine-print">Seller’s reason: {o.statusReason}</p>
              )}
              {o.status === 'awaiting_payment' && (
                <div className="collection-code">
                  <p style={{ margin: '0 0 8px' }}>
                    <strong>The seller accepted your order.</strong> Please pay{' '}
                    <span translate="no">{formatRand(o.totalCents)}</span> online
                    {o.paymentDueAt && (
                      <>
                        {' '}
                        before{' '}
                        {new Date(o.paymentDueAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
                      </>
                    )}
                    .
                  </p>
                  <button type="button" className="btn btn-primary btn-block" onClick={() => payNow(o.id)} disabled={busyId === o.id}>
                    {busyId === o.id ? 'Opening Payfast…' : `Pay ${formatRand(o.totalCents)} with Payfast`}
                  </button>
                  <p className="fine-print">You’ll pay on Payfast’s secure page. We never see your card details.</p>
                </div>
              )}
              {o.status === 'expired' && o.paymentStatus === 'unapplied' && o.refundPendingCents === 0 && (
                <p className="fine-print">
                  Your payment arrived after the time ran out. It is recorded and will be refunded.
                </p>
              )}
              {o.refundPendingCents > 0 && (
                <p className="fine-print">Refund of {formatRand(o.refundPendingCents)} is being processed by Payfast.</p>
              )}
              {o.refundedCents > 0 && <p className="fine-print">✓ {formatRand(o.refundedCents)} refunded to you.</p>}
              {o.status === 'confirmed' && (
                <p className="fine-print">
                  The seller is preparing your order.{o.paymentMethod === 'cash' && ' Cash still due.'}
                </p>
              )}
              {/* Only shown once Payfast's verified notification has marked the payment paid. */}
              {o.paymentStatus === 'paid' && <p className="fine-print">✓ Paid online with Payfast.</p>}
              {o.status === 'ready' && o.fulfilment === 'delivery' && (
                <p className="fine-print">Packed and waiting for a courier.</p>
              )}
              {((o.status === 'ready' && o.fulfilment === 'pickup') || o.status === 'out_for_delivery') && (
                <div className="collection-code">
                  <p style={{ margin: '0 0 8px' }}>
                    {o.status === 'out_for_delivery' ? (
                      <>
                        <strong>On the way</strong> with {o.courierName ?? 'your courier'}.
                      </>
                    ) : (
                      <>
                        <strong>Ready to collect</strong> from {o.businessName}, {o.businessArea}.
                      </>
                    )}
                    {o.paymentMethod === 'cash' && (
                      <>
                        {' '}
                        Have <span translate="no">{formatRand(o.totalCents)}</span> cash ready.
                      </>
                    )}
                  </p>
                  {codes[o.id] ? (
                    <>
                      <span className="code" translate="no" aria-label={`Collection code ${codes[o.id].code.split('').join(' ')}`}>
                        {codes[o.id].code}
                      </span>
                      <span className="fine-print">
                        Show this to the {o.status === 'out_for_delivery' ? 'courier' : 'seller'} when you get your
                        order. Valid until{' '}
                        {new Date(codes[o.id].expiresAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}.
                      </span>
                    </>
                  ) : (
                    <button type="button" className="btn btn-primary btn-block" onClick={() => showCode(o.id)} disabled={busyId === o.id}>
                      {busyId === o.id
                        ? 'Getting code…'
                        : o.status === 'out_for_delivery'
                          ? 'Show delivery code'
                          : 'Show collection code'}
                    </button>
                  )}
                </div>
              )}
            </article>
          )
        })
      )}
    </main>
  )
}
