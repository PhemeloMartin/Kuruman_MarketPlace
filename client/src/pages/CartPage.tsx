import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useCart } from '../cart/CartContext'
import { MokalaSmall } from '../components/Art'
import { MinusIcon, PlusIcon } from '../components/Icons'
import { ProductPhoto } from '../components/ProductCard'
import { api, ApiError } from '../lib/api'
import { formatRand } from '../lib/money'
import type { Product } from '../lib/types'

interface Policy {
  deliveryFeeCents: number
  sellerResponseMinutes: number
  onlinePaymentAvailable: boolean
}

// A fresh random key for each checkout. If "Send order" reaches the server twice
// (slow network, double tap), the server sees the same key and creates only one order.
function newRequestKey(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export function CartPage() {
  const cart = useCart()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [fulfilment, setFulfilment] = useState<'delivery' | 'pickup'>('pickup')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'online'>('cash')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const requestKey = useRef(newRequestKey())

  useEffect(() => {
    api<Policy>('/config').then(setPolicy).catch(() => setPolicy(null))
  }, [])

  // Re-check prices and stock against the server (on opening the cart, and after a conflict).
  const { lines, refresh } = cart
  const revalidate = useCallback(() => {
    Promise.all(
      lines.map((l) =>
        api<Product>(`/products/${l.productId}`)
          .then((p) => [l.productId, p] as const)
          .catch((err) => [l.productId, err instanceof ApiError && err.status === 404 ? null : undefined] as const),
      ),
    ).then((results) => {
      const latest = new Map<number, Product | null>()
      for (const [id, p] of results) if (p !== undefined) latest.set(id, p)
      setNotes(refresh(latest))
    })
  }, [lines, refresh])

  const revalidatedOnOpen = useRef(false)
  useEffect(() => {
    if (revalidatedOnOpen.current || lines.length === 0) return
    revalidatedOnOpen.current = true
    revalidate()
  }, [lines.length, revalidate])

  if (cart.lines.length === 0 || !cart.business) {
    return (
      <main className="page">
        <h1 className="page-title">Your cart</h1>
        {notes.length > 0 && <Notes notes={notes} />}
        <div className="empty">
          <MokalaSmall />
          <h2>Your cart is empty</h2>
          <p>Find something good from a Kuruman seller.</p>
          <Link to="/" className="btn btn-primary">
            Start shopping
          </Link>
        </div>
      </main>
    )
  }

  const deliveryFee = fulfilment === 'delivery' ? (policy?.deliveryFeeCents ?? 0) : 0
  const total = cart.subtotalCents + deliveryFee

  async function sendOrder() {
    if (!user) {
      navigate('/signin', { state: { from: '/cart' } })
      return
    }
    setSending(true)
    setError(null)
    setFields({})
    try {
      const r = await api<{ orderNumber: string }>('/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': requestKey.current },
        body: {
          businessId: cart.business!.id,
          items: cart.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          fulfilment,
          paymentMethod,
          deliveryAddress: fulfilment === 'delivery' ? address : null,
          expectedTotalCents: total,
        },
      })
      cart.clear()
      requestKey.current = newRequestKey()
      navigate('/orders', { state: { placed: r.orderNumber } })
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        setFields(err.fields)
        // Stock or price changed: this is a different order now, so it gets a new key.
        if (err.status === 409) {
          requestKey.current = newRequestKey()
          revalidate()
        }
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="page">
      <h1 className="page-title">Your cart</h1>
      <p className="cart-seller">
        Ordering from <strong>{cart.business.name}</strong> · one seller per order
      </p>

      {notes.length > 0 && <Notes notes={notes} />}

      <section aria-label="Items">
        {cart.lines.map((l) => (
          <div className="cart-line" key={l.productId}>
            <ProductPhoto product={{ id: l.productId, name: l.name, imageUrl: null }} className="cart-thumb product-photo" />
            <div className="cart-line-info">
              <div className="product-name">{l.name}</div>
              <div className="product-meta">
                {l.unitLabel} · <span translate="no">{formatRand(l.priceCents)}</span> each
              </div>
            </div>
            <div className="stepper">
              <button
                type="button"
                className="round-btn minus"
                onClick={() => cart.setQuantity(l.productId, l.quantity - 1)}
                aria-label={l.quantity === 1 ? `Remove ${l.name}` : `One less ${l.name}`}
              >
                <MinusIcon />
              </button>
              <span className="qty" aria-live="polite">
                {l.quantity}
              </span>
              <button
                type="button"
                className="round-btn"
                onClick={() => cart.setQuantity(l.productId, l.quantity + 1)}
                aria-label={`One more ${l.name}`}
              >
                <PlusIcon />
              </button>
            </div>
          </div>
        ))}
      </section>

      <fieldset className="choice-group">
        <legend>How do you want it?</legend>
        <div className="choices">
          <label className="choice">
            <input
              type="radio"
              name="fulfilment"
              checked={fulfilment === 'delivery'}
              onChange={() => setFulfilment('delivery')}
            />
            Delivery
          </label>
          <label className="choice">
            <input type="radio" name="fulfilment" checked={fulfilment === 'pickup'} onChange={() => setFulfilment('pickup')} />
            Pickup
          </label>
        </div>
      </fieldset>

      {fulfilment === 'delivery' && (
        <div className="field" data-invalid={Boolean(fields.deliveryAddress)} style={{ marginTop: 14 }}>
          <label htmlFor="address">Delivery address</label>
          <p className="hint" id="address-hint">
            Street and number, with a landmark if it helps (e.g. “opposite the clinic”).
          </p>
          <div className="input-wrap">
            <input
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              autoComplete="street-address"
              maxLength={300}
              aria-describedby={`address-hint${fields.deliveryAddress ? ' address-error' : ''}`}
              aria-invalid={Boolean(fields.deliveryAddress) || undefined}
            />
          </div>
          {fields.deliveryAddress && (
            <p className="field-error" id="address-error">
              {fields.deliveryAddress}
            </p>
          )}
        </div>
      )}

      <fieldset className="choice-group">
        <legend>How will you pay?</legend>
        <div className="choices">
          <label className="choice">
            <input type="radio" name="payment" checked={paymentMethod === 'cash'} onChange={() => setPaymentMethod('cash')} />
            Cash
          </label>
          <label className="choice" aria-disabled={!policy?.onlinePaymentAvailable}>
            <input
              type="radio"
              name="payment"
              checked={paymentMethod === 'online'}
              onChange={() => setPaymentMethod('online')}
              disabled={!policy?.onlinePaymentAvailable}
            />
            {policy?.onlinePaymentAvailable ? 'Pay online' : 'Pay online (soon)'}
          </label>
        </div>
        <p className="fine-print">You only pay online after the seller accepts your order.</p>
      </fieldset>

      <div className="totals" aria-label="Order total">
        <div className="totals-row">
          <span>Items ({cart.itemCount})</span>
          <span translate="no">{formatRand(cart.subtotalCents)}</span>
        </div>
        {fulfilment === 'delivery' && (
          <div className="totals-row">
            <span>Delivery</span>
            <span translate="no">{formatRand(deliveryFee)}</span>
          </div>
        )}
        <div className="totals-row total">
          <span>Total</span>
          <span className="price" translate="no">
            {formatRand(total)}
          </span>
        </div>
      </div>

      {error && (
        <p className="notice error" role="alert" style={{ marginTop: 14 }}>
          {error}
        </p>
      )}

      <div className="sticky-action">
        <button type="button" className="btn btn-primary btn-block" onClick={sendOrder} disabled={sending || !policy}>
          {sending ? 'Sending…' : user ? 'Send order to seller' : 'Sign in to send order'}
          <span translate="no">· {formatRand(total)}</span>
        </button>
        <p className="fine-print" style={{ textAlign: 'center' }}>
          The seller has {policy?.sellerResponseMinutes ?? 30} minutes to accept. Your cart is saved on this phone until you
          send it.
        </p>
      </div>
    </main>
  )
}

function Notes({ notes }: { notes: string[] }) {
  return (
    <div className="notice" role="status" style={{ marginBottom: 12 }}>
      <strong>Your cart was updated:</strong>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  )
}
