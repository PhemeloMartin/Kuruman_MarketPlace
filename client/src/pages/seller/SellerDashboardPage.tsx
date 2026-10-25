import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { PlusIcon, ShopIcon } from '../../components/Icons'
import { CodeScanButton } from '../../components/CodeScanButton'
import { pageUrl, shareLink } from '../../lib/whatsapp'
import { api, ApiError } from '../../lib/api'
import { formatRand, parseRandToCents } from '../../lib/money'
import type { CashToConfirm, Kpis, Rating, Review, SellerOrder, SellerProduct } from '../../lib/types'

interface Dashboard {
  business: { id: number; name: string; active: boolean }
  period: string
  asOf: string
  kpis: Kpis
}

const PERIODS = [
  { key: 'today', label: 'Today', phrase: 'today' },
  { key: 'week', label: 'This week', phrase: 'this week' },
  { key: 'month', label: 'This month', phrase: 'this month' },
]

const DECLINE_REASONS = ['Out of stock', 'Closed right now', "Can't prepare it in time"]
const REFRESH_MS = 20_000 // check for new orders every 20 seconds

function minutesLeft(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000))
}

function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' })
}

function greeting(): string {
  const hour = Number(new Date().toLocaleString('en-ZA', { hour: 'numeric', hour12: false, timeZone: 'Africa/Johannesburg' }))
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

// An order needs the seller when they must DO something now: accept it, get it ready, take the
// pickup code, hand it to the courier, or check returned goods. Orders waiting on someone else
// (the customer paying, a courier on the way) are shown separately.
function needsSeller(o: SellerOrder): boolean {
  if (o.status === 'pending_acceptance' || o.status === 'confirmed') return true
  if (o.status === 'ready' && o.fulfilment === 'pickup') return true
  if (o.status === 'ready' && o.delivery?.status === 'claimed' && !o.delivery.released) return true
  return Boolean(o.delivery?.awaitingReturn)
}

// The seller's home: what to do now comes first, then how the shop is doing, in plain words.
export function SellerDashboardPage() {
  const { user } = useAuth()
  const [period, setPeriod] = useState('week')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [orders, setOrders] = useState<SellerOrder[] | null>(null)
  const [cash, setCash] = useState<CashToConfirm[]>([])
  const [products, setProducts] = useState<SellerProduct[]>([])
  const [reviews, setReviews] = useState<{ rating: Rating; reviews: Review[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([
      api<Dashboard>(`/seller/dashboard?period=${period}`),
      api<SellerOrder[]>('/seller/orders'),
      api<CashToConfirm[]>('/seller/cash'),
      api<SellerProduct[]>('/seller/products'),
      api<{ rating: Rating; reviews: Review[] }>('/seller/reviews'),
    ])
      .then(([d, o, c, p, r]) => {
        setReviews(r)
        setDashboard(d)
        setOrders(o)
        setCash(c)
        setProducts(p)
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
  const toDo = orders.filter(needsSeller)
  const toDoCash = cash.filter((c) => c.status === 'collected')
  const disputedCash = cash.filter((c) => c.status === 'disputed')
  const waitingOnOthers = orders.filter(
    (o) => !needsSeller(o) && ['awaiting_payment', 'ready', 'out_for_delivery', 'delivery_failed'].includes(o.status),
  )
  const history = orders.filter(
    (o) => ['completed', 'declined', 'cancelled', 'expired'].includes(o.status) && !o.delivery?.awaitingReturn,
  )
  const onSale = products.filter((p) => p.isActive)
  // Same rule as the server's low-stock number: what's left to sell is at or below the seller's own warning level.
  const lowStock = onSale.filter((p) => p.availableQty <= p.lowStockThreshold)
  const firstName = (user?.displayName ?? '').split(' ')[0]
  const phrase = PERIODS.find((p) => p.key === period)?.phrase ?? ''
  const toDoCount = toDo.length + toDoCash.length
  const nothingToDo = toDoCount === 0 && lowStock.length === 0

  return (
    <main className="page seller">
      <p className="eyebrow">
        {greeting()}
        {firstName && `, ${firstName}`}
      </p>
      <h1 className="page-title" style={{ marginTop: 0, marginBottom: 6 }}>
        {dashboard.business.name}
      </h1>
      {dashboard.business.active ? (
        <p className="shop-status">
          <span className="status-dot" aria-hidden="true" /> Open · {onSale.length}{' '}
          {onSale.length === 1 ? 'product' : 'products'} on sale
        </p>
      ) : (
        <p className="notice error" role="status" style={{ marginBottom: 12 }}>
          <strong>Your shop is suspended by support.</strong> Customers can’t see it and you can’t change your listings.
          You can still finish the orders below. Contact support to resolve this.
        </p>
      )}

      {error && (
        <p className="notice error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}

      <section aria-labelledby="todo-heading" className="seller-section">
        <div className="section-head">
          <h2 id="todo-heading">
            To do now {toDoCount > 0 && <span className="count-badge">{toDoCount}</span>}
          </h2>
          {toDo.some((o) => o.status === 'pending_acceptance') && <span className="urgent">Reply within 30 min</span>}
        </div>

        {nothingToDo && (
          <div className="all-clear">
            <strong>All caught up ✓</strong>
            <p>No orders need you right now. New orders appear here by themselves, and you also get a notification.</p>
          </div>
        )}

        {toDo.map((o) => (
          <OrderCard key={o.id} order={o} onChanged={load} />
        ))}
        {toDoCash.map((c) => (
          <CashCard key={c.orderId} cash={c} onChanged={load} />
        ))}

        {lowStock.length > 0 && (
          <article className="card low-stock">
            <strong>Running low</strong>
            <ul>
              {lowStock.slice(0, 5).map((p) => (
                <li key={p.id}>
                  <Link to={`/seller/products/${p.id}`}>{p.name}</Link>:{' '}
                  {p.availableQty <= 0 ? <span className="urgent">sold out</span> : `${p.availableQty} left`}
                </li>
              ))}
            </ul>
            <Link to="/seller/products" className="btn btn-outline btn-block">
              Update stock
            </Link>
          </article>
        )}
      </section>

      <div className="action-tiles">
        <Link to="/seller/products/new" className="action-tile primary">
          <PlusIcon />
          Add a product
        </Link>
        <Link to="/seller/products" className="action-tile">
          <ShopIcon />
          Products &amp; stock
          <span className="action-count">{products.length}</span>
        </Link>
        <Link to="/seller/reviews" className="action-tile">
          <span aria-hidden="true" className="tile-emoji">★</span>
          Reviews
          <span className="action-count">
            {reviews?.rating.average ? `${reviews.rating.average.toFixed(1)} (${reviews.rating.count})` : '–'}
          </span>
          {reviews && reviews.reviews.some((r) => !r.sellerReply) && (
            <span className="tile-note">{reviews.reviews.filter((r) => !r.sellerReply).length} to reply to</span>
          )}
        </Link>
        <Link to="/seller/shop" className="action-tile">
          <span aria-hidden="true" className="tile-emoji">🖼</span>
          Shop photo &amp; about
        </Link>
        <Link to={`/shop/${dashboard.business.id}`} className="action-tile">
          <span aria-hidden="true" className="tile-emoji">👀</span>
          See my shop
        </Link>
        <a
          className="action-tile whatsapp-tile"
          href={shareLink(`Order from ${dashboard.business.name} on KurumanMarketPlace:`, pageUrl(`/shop/${dashboard.business.id}`))}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span aria-hidden="true" className="tile-emoji">💬</span>
          Share my shop on WhatsApp
        </a>
      </div>

      <section aria-labelledby="numbers-heading" className="seller-section">
        <div className="section-head">
          <h2 id="numbers-heading">How your shop is doing</h2>
        </div>
        <div className="chips" role="group" aria-label="Period" style={{ marginBottom: 12 }}>
          {PERIODS.map((p) => (
            <button key={p.key} type="button" className="chip" aria-pressed={period === p.key} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        {k.completedOrders === 0 && k.acceptanceRate === null ? (
          <p className="notice">
            Nothing accepted or completed {phrase} yet. Your numbers appear here once you’ve answered your first order.
          </p>
        ) : (
          <ul className="plain-stats">
            <li>
              <span className="stat-value" translate="no">
                {formatRand(k.grossDeliveredCents)}
              </span>
              <span>
                from {k.completedOrders} completed {k.completedOrders === 1 ? 'order' : 'orders'} {phrase}
              </span>
              <span className="stat-note">
                What customers paid for your products. Delivery fees go to couriers, and your own costs aren’t taken
                off.
              </span>
            </li>
            {k.acceptanceRate !== null && (
              <li>
                <span className="stat-value">{Math.round(k.acceptanceRate * 100)}%</span>
                <span>of orders accepted {phrase}</span>
                <span className="stat-note">Accepting quickly keeps customers coming back.</span>
              </li>
            )}
            {k.averageCompletedCents !== null && (
              <li>
                <span className="stat-value" translate="no">
                  {formatRand(Math.round(k.averageCompletedCents))}
                </span>
                <span>average completed order</span>
              </li>
            )}
          </ul>
        )}
        {k.unreconciledCashCents > 0 && (
          <p className="notice" style={{ marginTop: 10 }}>
            <strong translate="no">{formatRand(k.unreconciledCashCents)}</strong> in cash from couriers hasn’t reached
            you yet.
          </p>
        )}
        <p className="fine-print">Updated at {timeOfDay(dashboard.asOf)}.</p>
      </section>

      {(waitingOnOthers.length > 0 || disputedCash.length > 0) && (
        <section aria-labelledby="others-heading" className="seller-section">
          <div className="section-head">
            <h2 id="others-heading">Waiting on someone else</h2>
          </div>
          <p className="fine-print" style={{ marginTop: -6 }}>
            Nothing for you to do here yet: the customer is paying, a courier is on the way, or support is checking.
          </p>
          {waitingOnOthers.map((o) => (
            <OrderCard key={o.id} order={o} onChanged={load} />
          ))}
          {disputedCash.map((c) => (
            <CashCard key={c.orderId} cash={c} onChanged={load} />
          ))}
        </section>
      )}

      {history.length > 0 && (
        <section aria-labelledby="history-heading" className="seller-section">
          <div className="section-head">
            <h2 id="history-heading">Order history</h2>
          </div>
          {history.map((o) => (
            <OrderCard key={o.id} order={o} onChanged={load} />
          ))}
        </section>
      )}
    </main>
  )
}

const PILL: Record<string, { label: string; tone: string }> = {
  pending_acceptance: { label: 'New', tone: 'new' },
  awaiting_payment: { label: 'Waiting for payment', tone: 'wait' },
  confirmed: { label: 'Confirmed', tone: 'good' },
  ready: { label: 'Ready', tone: 'good' },
  out_for_delivery: { label: 'With courier', tone: 'good' },
  delivery_failed: { label: 'Not delivered', tone: 'bad' },
  completed: { label: 'Completed', tone: 'good' },
  declined: { label: 'Declined', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
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
          <CodeScanButton
            onCode={(scanned) => {
              setCode(scanned)
              act('pickup', { code: scanned })
            }}
          />
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
        <DeliveryStep order={o} busy={busy} onRelease={() => act('release')} />
      )}
      {o.status === 'out_for_delivery' && o.delivery?.courierName && (
        <p className="fine-print">{o.delivery.courierName} is delivering it.</p>
      )}
      {o.status === 'delivery_failed' && (
        <p className="notice" style={{ marginTop: 8 }}>
          {o.delivery?.courierName} couldn’t hand it over. Support is deciding: another delivery attempt, or cancel.
        </p>
      )}
      {o.delivery?.awaitingReturn && (
        <div style={{ marginTop: 8 }}>
          <p className="notice">
            Cancelled after a failed delivery. {o.delivery.courierName} is bringing the goods back. When you have them,
            check them:
          </p>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('returned', { restock: true })}>
              Back in stock
            </button>
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => act('returned', { restock: false })}>
              Can’t resell
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </article>
  )
}

// Delivery orders after "ready": wait for a courier, then confirm handing the goods to them.
function DeliveryStep({ order: o, busy, onRelease }: { order: SellerOrder; busy: boolean; onRelease: () => void }) {
  const d = o.delivery
  if (!d || d.status === 'open') return <p className="fine-print">Waiting for a courier to take the job.</p>
  if (d.status === 'claimed' && !d.released) {
    return (
      <>
        <p className="fine-print">{d.courierName} is coming to collect it. Tap below when you give them the order.</p>
        <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 8 }} disabled={busy} onClick={onRelease}>
          {busy ? 'Saving…' : `Hand over to ${d.courierName?.split(' ')[0]}`}
        </button>
      </>
    )
  }
  return <p className="fine-print">Handed to {d.courierName}. Waiting for them to confirm pickup.</p>
}

// The seller confirms how much cash the courier handed over (spec BR-11).
// A different amount is recorded as disputed - the gap stays visible, never written off.
function CashCard({ cash: c, onChanged }: { cash: CashToConfirm; onChanged: () => void }) {
  const [other, setOther] = useState(false)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm(receivedCents: number) {
    setBusy(true)
    setError(null)
    try {
      await api(`/seller/cash/${c.orderId}/acknowledge`, { method: 'POST', body: { receivedCents } })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (c.status === 'disputed') {
    return (
      <article className="card">
        <div className="order-card-head">
          <strong translate="no">Order {c.orderNumber}</strong>
          <span className="status-pill bad">Amount disputed</span>
        </div>
        <p className="product-meta" style={{ margin: '4px 0 0' }}>
          You received <span translate="no">{formatRand(c.remittedCents)}</span> of{' '}
          <span translate="no">{formatRand(c.collectedCents)}</span> from {c.courierName}. The difference stays on
          record until it’s sorted out.
        </p>
      </article>
    )
  }

  const typed = parseRandToCents(amount)
  return (
    <article className="card">
      <div className="order-card-head">
        <strong translate="no">Order {c.orderNumber}</strong>
        <span className="status-pill wait">Cash with courier</span>
      </div>
      <p className="product-meta" style={{ margin: '4px 0 0' }}>
        {c.courierName} collected <strong translate="no">{formatRand(c.collectedCents)}</strong> for you.
      </p>
      {!other ? (
        <div className="btn-row">
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setOther(true)}>
            Different amount
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => confirm(c.collectedCents)}>
            Received {formatRand(c.collectedCents)}
          </button>
        </div>
      ) : (
        <div className="btn-row">
          <div className="input-wrap">
            <label className="visually-hidden" htmlFor={`cash-${c.orderId}`}>
              Amount received in rand
            </label>
            <input
              id={`cash-${c.orderId}`}
              inputMode="decimal"
              placeholder="Amount (R)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy || typed === null}
            onClick={() => typed !== null && confirm(typed)}
          >
            Confirm amount
          </button>
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </article>
  )
}
