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
  expired: { label: 'Seller didn’t respond', tone: 'bad' },
}

function timeLeft(iso: string): string {
  const mins = Math.ceil((new Date(iso).getTime() - Date.now()) / 60000)
  return mins > 0 ? `seller has ${mins} min left to reply` : 'waiting for the seller'
}

export function OrdersPage() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const placed = (location.state as { placed?: string } | null)?.placed
  const [orders, setOrders] = useState<OrderSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [codes, setCodes] = useState<Record<number, { code: string; expiresAt: string }>>({})

  const load = useCallback(() => {
    api<OrderSummary[]>('/orders/mine')
      .then(setOrders)
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    if (user) load()
  }, [user, load])

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
              {o.status === 'declined' && o.statusReason && (
                <p className="fine-print">Seller’s reason: {o.statusReason}</p>
              )}
              {o.status === 'confirmed' && (
                <p className="fine-print">
                  The seller is preparing your order.{o.paymentMethod === 'cash' && ' Cash still due.'}
                </p>
              )}
              {o.status === 'ready' && o.fulfilment === 'pickup' && (
                <div className="collection-code">
                  <p style={{ margin: '0 0 8px' }}>
                    <strong>Ready to collect</strong> from {o.businessName}, {o.businessArea}.
                    {o.paymentMethod === 'cash' && (
                      <>
                        {' '}
                        Bring <span translate="no">{formatRand(o.totalCents)}</span> cash.
                      </>
                    )}
                  </p>
                  {codes[o.id] ? (
                    <>
                      <span className="code" translate="no" aria-label={`Collection code ${codes[o.id].code.split('').join(' ')}`}>
                        {codes[o.id].code}
                      </span>
                      <span className="fine-print">
                        Show this to the seller. Valid until{' '}
                        {new Date(codes[o.id].expiresAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}.
                      </span>
                    </>
                  ) : (
                    <button type="button" className="btn btn-primary btn-block" onClick={() => showCode(o.id)} disabled={busyId === o.id}>
                      {busyId === o.id ? 'Getting code…' : 'Show collection code'}
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
