import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BackIcon } from '../../components/Icons'
import { KurumanPanorama } from '../../components/Markets'
import { api, ApiError } from '../../lib/api'
import { shrinkPhoto } from '../../lib/photos'
import { parseRandToCents } from '../../lib/money'

interface MyShop {
  id: number
  name: string
  description: string | null
  area: string
  coverPhotoUrl: string | null
  whatsappPhone: string | null
  ownDeliveryFeeCents: number | null
  ownDeliveryNote: string | null
  phone: string
  kind: 'shop' | 'market_stall'
  stallLocation: string | null
  stallDays: number[]
  stallOpens: string | null
  stallCloses: string | null
  smsAlerts: boolean
}

const WEEKDAYS = [
  [1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun'],
] as const

// What customers see at the top of the shop page: a cover photo and a few words about the shop.
export function SellerShopPage() {
  const [shop, setShop] = useState<MyShop | null>(null)
  const [description, setDescription] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [delivers, setDelivers] = useState(false)
  const [fee, setFee] = useState('')
  const [deliveryNote, setDeliveryNote] = useState('')
  const [stallLocation, setStallLocation] = useState('')
  const [stallDays, setStallDays] = useState<number[]>([])
  const [opens, setOpens] = useState('07:00')
  const [closes, setCloses] = useState('16:00')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  function load() {
    return api<MyShop>('/seller/shop').then((s) => {
      setShop(s)
      setDescription(s.description ?? '')
      setWhatsapp(s.whatsappPhone ? '0' + s.whatsappPhone.slice(3) : '')
      setDelivers(s.ownDeliveryFeeCents !== null)
      setFee(s.ownDeliveryFeeCents !== null ? (s.ownDeliveryFeeCents / 100).toFixed(2) : '')
      setDeliveryNote(s.ownDeliveryNote ?? '')
      setStallLocation(s.stallLocation ?? '')
      setStallDays(s.stallDays)
      if (s.stallOpens) setOpens(s.stallOpens)
      if (s.stallCloses) setCloses(s.stallCloses)
    })
  }
  useEffect(() => {
    load().catch((err) => setMessage({ ok: false, text: err.message }))
  }, [])

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true)
    setMessage(null)
    try {
      await action()
      await load()
      setMessage({ ok: true, text: done })
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong.' })
    } finally {
      setBusy(false)
    }
  }

  if (!shop) {
    return (
      <main className="page">
        {message ? <p className="notice error">{message.text}</p> : <div className="skeleton" style={{ minHeight: 300 }} />}
      </main>
    )
  }

  return (
    <main className="page">
      <Link to="/seller" className="back-link">
        <BackIcon /> Dashboard
      </Link>
      <h1 className="page-title">Your shop page</h1>
      <p className="lead">This is what customers see when they open {shop.name}.</p>

      {message && (
        <p className={`notice${message.ok ? ' success' : ' error'}`} role="status" style={{ marginBottom: 12 }}>
          {message.text}
        </p>
      )}

      <section className="card">
        <strong>Cover photo</strong>
        <p className="fine-print" style={{ marginTop: 4 }}>
          A wide photo of your stall, shop, kitchen or products. It replaces the old one.
        </p>
        <div className="shop-cover small">{shop.coverPhotoUrl ? <img src={shop.coverPhotoUrl} alt="Your cover photo" /> : <KurumanPanorama />}</div>
        <label className={`btn btn-outline btn-block${busy ? ' busy' : ''}`}>
          <input
            type="file"
            accept="image/*"
            className="visually-hidden"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) {
                run(async () => api('/seller/photos?cover=1', { method: 'POST', body: await shrinkPhoto(file) }), 'Cover photo updated.')
              }
            }}
          />
          {busy ? 'Uploading…' : shop.coverPhotoUrl ? 'Change cover photo' : 'Add a cover photo'}
        </label>
      </section>

      <section className="card">
        <label htmlFor="about">
          <strong>About your shop</strong>
        </label>
        <p className="fine-print" style={{ marginTop: 4 }}>
          A few friendly lines: what you sell, since when, what makes you special. For example: “Fresh vegetables from
          our garden in Wrenchville since 2015. Picked every morning.”
        </p>
        <div className="input-wrap">
          <textarea id="about" rows={4} maxLength={600} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <p className="fine-print">{600 - description.length} characters left</p>
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={busy || description === (shop.description ?? '')}
          onClick={() => run(() => api('/seller/shop', { method: 'PATCH', body: { description } }), 'Saved.')}
        >
          Save
        </button>
      </section>

      <section className="card">
        <label htmlFor="whatsapp">
          <strong>WhatsApp number (optional)</strong>
        </label>
        <p className="fine-print" style={{ marginTop: 4 }}>
          Shows a “Chat on WhatsApp” button so customers can ask questions. Their message includes a link to your
          product here, and orders and payments still happen on KurumanMarketPlace, where they’re protected. Leave it
          empty to hide the button.
        </p>
        <div className="input-wrap">
          <input id="whatsapp" type="tel" inputMode="tel" placeholder="071 234 5678" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
        </div>
        <button
          type="button"
          className="btn btn-primary btn-block"
          style={{ marginTop: 10 }}
          disabled={busy}
          onClick={() => run(() => api('/seller/shop', { method: 'PATCH', body: { whatsappPhone: whatsapp } }), whatsapp.trim() ? 'WhatsApp button is on.' : 'WhatsApp button is off.')}
        >
          Save WhatsApp number
        </button>
      </section>

      <section className="card">
        <strong>Orders by SMS</strong>
        <p className="fine-print" style={{ marginTop: 4 }}>
          Each new order is also sent by SMS to the business phone{' '}
          <strong translate="no">{'0' + shop.phone.slice(3)}</strong>, which can answer: <strong>1</strong> to accept,{' '}
          <strong>2</strong> if sold out, or the customer’s 6-digit code when they collect. Works on any phone.
        </p>
        <label className="choice">
          <input
            type="checkbox"
            checked={shop.smsAlerts}
            disabled={busy}
            onChange={(e) => run(() => api('/seller/shop', { method: 'PATCH', body: { smsAlerts: e.target.checked } }), e.target.checked ? 'SMS orders are on.' : 'SMS orders are off.')}
          />
          Send new orders to this phone by SMS
        </label>
        <Link to="/demo/phone" className="link-btn">
          Try it on the demo phone
        </Link>
      </section>

      <section className="card">
        <strong>Market stall: where and when</strong>
        <p className="fine-print" style={{ marginTop: 4 }}>
          {shop.kind === 'market_stall'
            ? 'Customers see this on your page, with “At the stall now” when you’re there.'
            : 'Selling from a market stall? Fill this in and your page shows where to find you and when.'}
        </p>
        <div className="field">
          <label htmlFor="stallLocation">Where</label>
          <div className="input-wrap">
            <input id="stallLocation" maxLength={200} placeholder="Main Street, by the taxi rank" value={stallLocation} onChange={(e) => setStallLocation(e.target.value)} />
          </div>
        </div>
        <fieldset className="choice-group">
          <legend>Which days</legend>
          <div className="day-picker">
            {WEEKDAYS.map(([d, label]) => (
              <label key={d} className={`day${stallDays.includes(d) ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  className="visually-hidden"
                  checked={stallDays.includes(d)}
                  onChange={(e) => setStallDays((days) => (e.target.checked ? [...days, d] : days.filter((x) => x !== d)))}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="two-col">
          <div className="field">
            <label htmlFor="opens">From</label>
            <div className="input-wrap">
              <input id="opens" type="time" value={opens} onChange={(e) => setOpens(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="closes">Until</label>
            <div className="input-wrap">
              <input id="closes" type="time" value={closes} onChange={(e) => setCloses(e.target.value)} />
            </div>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={busy}
          onClick={() =>
            run(
              () => api('/seller/shop', { method: 'PATCH', body: { stall: { location: stallLocation, days: stallDays, opens, closes } } }),
              'Stall details saved.',
            )
          }
        >
          Save stall details
        </button>
      </section>

      <section className="card">
        <strong>Do you deliver with your own vehicle?</strong>
        <p className="fine-print" style={{ marginTop: 4 }}>
          For things too big for our couriers (bricks, sand, feed, livestock), customers can then choose “Seller
          delivers”. You set your own fee, and take the customer’s code at the door, like a pickup.
        </p>
        <label className="choice">
          <input type="checkbox" checked={delivers} onChange={(e) => setDelivers(e.target.checked)} />
          Yes, we deliver ourselves
        </label>
        {delivers && (
          <>
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="fee">Your delivery fee (R)</label>
              <div className="input-wrap">
                <input id="fee" inputMode="decimal" placeholder="350.00" value={fee} onChange={(e) => setFee(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="dnote">Vehicle and areas (optional)</label>
              <div className="input-wrap">
                <input id="dnote" maxLength={200} placeholder="e.g. Bakkie. Kuruman and Batlharos." value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} />
              </div>
            </div>
          </>
        )}
        <button
          type="button"
          className="btn btn-primary btn-block"
          style={{ marginTop: 10 }}
          disabled={busy || (delivers && parseRandToCents(fee || '0') === null)}
          onClick={() =>
            run(
              () =>
                api('/seller/shop', {
                  method: 'PATCH',
                  body: { ownDeliveryFeeCents: delivers ? parseRandToCents(fee || '0') : null, ownDeliveryNote: deliveryNote },
                }),
              delivers ? 'Own delivery is on.' : 'Own delivery is off.',
            )
          }
        >
          Save delivery setting
        </button>
      </section>

      <Link to={`/shop/${shop.id}`} className="btn btn-outline btn-block">
        See my shop as customers see it
      </Link>
    </main>
  )
}
