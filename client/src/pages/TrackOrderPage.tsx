import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { CallButton } from '../components/CallButton'
import { DeliveryChat } from '../components/DeliveryChat'
import { HandoverCode } from '../components/HandoverCode'
import { MapView } from '../components/MapView'
import type { MapPin } from '../components/DeliveryMap'
import { api, ApiError } from '../lib/api'
import { VEHICLE_EMOJI, currentPosition, type Point } from '../lib/geo'
import { formatRand } from '../lib/money'
import type { Fulfilment } from '../lib/types'

interface Tracking {
  orderId: number
  orderNumber: string
  status: string
  statusReason: string | null
  fulfilment: Fulfilment
  paymentMethod: 'cash' | 'online'
  totalCents: number
  shop: { name: string; area: string }
  destination: { address: string; location: Point | null } | null
  canSetPin: boolean
  delivery: {
    status: 'open' | 'claimed' | 'collected' | 'delivered' | 'failed' | 'cancelled'
    courier: { name: string; vehicleType: string } | null
    courierLocation: (Point & { accuracyM: number | null; secondsAgo: number }) | null
    distanceKm: number | null
    etaMinutes: number | null
  } | null
  mapCentre: Point
  unreadMessages: number // from the courier, not seen yet
  canMessage: boolean // a courier has the order
  canCall: boolean // it's on its way
}

const REFRESH_MS = 10_000
const FINISHED = ['completed', 'declined', 'cancelled', 'expired']

// The steps of each kind of order, and how far this one has got (an index into them).
function progress(t: Tracking): { steps: string[]; at: number } | null {
  const early: Record<string, number> = { pending_acceptance: 0, awaiting_payment: 0, confirmed: 1 }
  if (t.fulfilment === 'pickup') {
    const at = { ...early, ready: 2, completed: 3 }[t.status]
    return at === undefined ? null : { steps: ['Order sent', 'Accepted', 'Ready to collect', 'Collected'], at }
  }
  if (t.fulfilment === 'seller_delivery') {
    const at = { ...early, ready: 2, out_for_delivery: 3, completed: 4 }[t.status]
    return at === undefined ? null : { steps: ['Order sent', 'Accepted', 'Packed', 'On the way', 'Delivered'], at }
  }
  const collecting = t.delivery?.status === 'claimed'
  const at = { ...early, ready: collecting ? 3 : 2, out_for_delivery: 4, completed: 5 }[t.status]
  return at === undefined ? null : { steps: ['Order sent', 'Accepted', 'Packed', 'Courier collecting', 'On the way', 'Delivered'], at }
}

function headline(t: Tracking): { title: string; detail?: string } {
  const courier = t.delivery?.courier?.name ?? 'Your courier'
  switch (t.status) {
    case 'pending_acceptance':
      return { title: `Waiting for ${t.shop.name} to accept`, detail: 'They have 30 minutes to reply.' }
    case 'awaiting_payment':
      return { title: 'Accepted – please pay online', detail: 'Pay on Your orders to confirm it.' }
    case 'confirmed':
      return { title: `${t.shop.name} is preparing your order` }
    case 'ready':
      if (t.fulfilment === 'pickup') return { title: 'Ready to collect', detail: `At ${t.shop.name}, ${t.shop.area}.` }
      if (t.fulfilment === 'seller_delivery') return { title: 'Packed – the shop will bring it soon' }
      return t.delivery?.status === 'claimed'
        ? { title: `${courier} is collecting your order`, detail: `From ${t.shop.name}, ${t.shop.area}.` }
        : { title: 'Packed – finding a courier' }
    case 'out_for_delivery':
      return t.fulfilment === 'seller_delivery' ? { title: `${t.shop.name} is on the way to you` } : { title: `${courier} is on the way` }
    case 'delivery_failed':
      return { title: 'Not delivered', detail: `${t.statusReason ?? 'The order couldn’t be handed over'}. Support will contact you.` }
    case 'completed':
      return { title: t.fulfilment === 'pickup' ? 'Collected' : 'Delivered', detail: 'Thank you for shopping local!' }
    case 'declined':
      return { title: 'Declined by the shop', detail: t.statusReason ?? undefined }
    case 'expired':
      return { title: 'Expired', detail: 'Nothing was charged.' }
    default:
      return { title: 'Cancelled', detail: t.statusReason ?? undefined }
  }
}

// "1.2 km away · about 5 min", or why we can't say yet.
function distanceLine(t: Tracking): string | null {
  const d = t.delivery
  if (!d || d.status !== 'collected') return null
  if (d.distanceKm !== null && d.etaMinutes !== null) {
    const far = d.distanceKm < 1 ? `${Math.round(d.distanceKm * 1000)} m` : `${d.distanceKm} km`
    return `${far} away · about ${d.etaMinutes} min`
  }
  if (!t.destination?.location) return 'Share where you are (below) to see how far away they are.'
  return 'We’ll show how far away they are as soon as their phone shares its location.'
}

function freshness(secondsAgo: number): string {
  if (secondsAgo < 60) return 'Location updated just now'
  const min = Math.round(secondsAgo / 60)
  return min < 3 ? `Location updated ${min} min ago` : `Last seen ${min} min ago – their phone may have no signal.`
}

// Following one order, like a delivery app: the steps, a map with you and the courier, how far away they are,
// and the delivery code. Refreshes every 10 seconds until the order is finished.
export function TrackOrderPage() {
  const { id } = useParams()
  const { user, loading } = useAuth()
  const [t, setT] = useState<Tracking | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pinning, setPinning] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<Tracking>(`/orders/${id}/tracking`)
      .then((x) => {
        setT(x)
        setError(null)
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load your order. Check your connection.'))
  }, [id])

  const finished = t ? FINISHED.includes(t.status) : false
  useEffect(() => {
    if (!user) return
    load()
    if (finished) return
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [user, load, finished])

  async function shareWhereIAm() {
    setPinning(true)
    setPinError(null)
    try {
      const p = await currentPosition()
      await api(`/orders/${id}/location`, { method: 'POST', body: { lat: p.lat, lng: p.lng } })
      load()
    } catch (err) {
      setPinError((err as Error).message)
    } finally {
      setPinning(false)
    }
  }

  if (loading) return null
  if (!user) {
    return (
      <main className="page">
        <h1 className="page-title">Track your order</h1>
        <Link to="/signin" state={{ from: `/orders/${id}/track` }} className="btn btn-primary">
          Sign in to follow your order
        </Link>
      </main>
    )
  }
  if (!t) {
    return (
      <main className="page">
        <h1 className="page-title">Track your order</h1>
        {error ? <p className="notice error">{error}</p> : <div className="skeleton" style={{ minHeight: 320 }} aria-busy="true" />}
      </main>
    )
  }

  const h = headline(t)
  const steps = progress(t)
  const distance = distanceLine(t)
  const d = t.delivery
  const pins: MapPin[] = []
  if (t.destination?.location) pins.push({ id: 'home', ...t.destination.location, emoji: '🏠', label: 'You (where we deliver)' })
  if (d?.courierLocation) {
    pins.push({
      id: 'courier',
      lat: d.courierLocation.lat,
      lng: d.courierLocation.lng,
      emoji: VEHICLE_EMOJI[d.courier?.vehicleType ?? ''] ?? '🛵',
      label: `${d.courier?.name ?? 'Courier'} (courier)`,
    })
  }
  const showMap = !finished && t.fulfilment !== 'pickup' && pins.length > 0

  return (
    <main className="page">
      <p className="product-meta" style={{ margin: 0 }}>
        <span translate="no">Order {t.orderNumber}</span> · {t.shop.name}
      </p>
      <h1 className="track-title" aria-live="polite">
        {h.title}
      </h1>
      {distance && <p className="track-distance">{distance}</p>}
      {h.detail && <p className="product-meta">{h.detail}</p>}
      {error && <p className="notice error">{error}</p>}

      {showMap && (
        <>
          <MapView label="Map with your delivery place and the courier" centre={t.mapCentre} height={300} pins={pins} />
          {d?.courierLocation && <p className="fine-print">{freshness(d.courierLocation.secondsAgo)}</p>}
        </>
      )}

      {t.canMessage && d?.courier && (
        <DeliveryChat
          orderId={t.orderId}
          otherName={d.courier.name}
          unread={t.unreadMessages}
          quickReplies={['I’m coming out now', 'I’m at the gate', 'Please call me']}
        />
      )}
      {t.canCall && d?.courier && <CallButton target={{ orderId: t.orderId, with: 'courier' }} label={`📞 Call ${d.courier.name} free`} />}

      {t.canSetPin && !t.destination?.location && (
        <div className="location-picker">
          <strong>📍 Help {d?.courier?.name ?? 'the courier'} find you</strong>
          <p className="hint" style={{ marginTop: 2 }}>
            Share where you are now, so they can follow directions to your door and you can see how far away they are.
          </p>
          <button type="button" className="btn btn-outline" onClick={shareWhereIAm} disabled={pinning}>
            {pinning ? 'Finding you…' : 'Share where I am'}
          </button>
          {pinError && <p className="field-error">{pinError}</p>}
        </div>
      )}

      {steps && (
        <ol className="track-steps" aria-label="Progress">
          {steps.steps.map((label, i) => (
            <li key={label} className={i < steps.at ? 'done' : i === steps.at ? 'done current' : ''} aria-current={i === steps.at ? 'step' : undefined}>
              {label}
            </li>
          ))}
        </ol>
      )}

      {(t.status === 'out_for_delivery' || (t.status === 'ready' && t.fulfilment === 'pickup')) && (
        <div className="collection-code">
          {t.paymentMethod === 'cash' && (
            <p style={{ margin: '0 0 8px' }}>
              Have <strong translate="no">{formatRand(t.totalCents)}</strong> cash ready.
            </p>
          )}
          <HandoverCode orderId={t.orderId} showTo={t.status === 'out_for_delivery' ? 'courier' : 'seller'} />
        </div>
      )}

      {t.destination && (
        <p className="fine-print" style={{ marginTop: 12 }}>
          Delivering to: {t.destination.address}
        </p>
      )}
      <Link to="/orders" className="link-btn" style={{ display: 'inline-block', marginTop: 8 }}>
        ← All your orders
      </Link>
    </main>
  )
}
