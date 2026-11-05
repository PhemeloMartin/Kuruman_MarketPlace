import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { CodeScanButton } from '../../components/CodeScanButton'
import { DOCUMENT_LABEL, readDocument } from '../../lib/documents'
import { formatRand } from '../../lib/money'
import { MapView } from '../../components/MapView'
import { CallButton } from '../../components/CallButton'
import { DeliveryChat } from '../../components/DeliveryChat'
import type { MapPin } from '../../components/DeliveryMap'
import { InAppDirections } from '../../components/InAppDirections'
import { VEHICLE_EMOJI, mapsAppLink, type Point } from '../../lib/geo'
import { useLiveLocation, type Sharing } from '../../lib/useLiveLocation'
import { usePaymentTestMode } from '../../lib/paymentMode'

interface OpenJob {
  id: number
  feeCents: number
  cashToCollectCents: number
  businessName: string
  businessArea: string
  itemCount: number
  createdAt: string
}

interface MyJob {
  id: number
  orderId: number
  vehicleType: string
  unreadMessages: number // from the customer, not seen yet
  status: 'claimed' | 'collected' | 'delivered' | 'failed'
  orderNumber: string
  feeCents: number
  cashToCollectCents: number
  cashStatus: 'collected' | 'remitted' | 'disputed' | null
  releasedBySeller: boolean
  business: { name: string; area: string; pickupAddress: string | null; phone: string | null; directionsUrl: string | null }
  customer: {
    name: string
    phone: string
    address: string
    notes: string | null
    location: { lat: number; lng: number } | null // the customer's map pin, if they dropped one
    directionsUrl: string // Google Maps: to the pin, or else to the written address
  } | null
  items: { name: string; quantity: number }[]
  failedReason: string | null
  orderStatus: string // after a failure: delivery_failed = support deciding, cancelled = take goods back
}

// Why a delivery didn't work (the server accepts exactly these codes).
const FAIL_REASONS: Record<string, string> = {
  customer_absent: 'Nobody was there',
  wrong_address: 'Couldn’t find the address',
  customer_refused: 'Customer refused the order',
  no_payment: 'Customer couldn’t pay the cash',
}

const REFRESH_MS = 15_000

// Opens directions in the phone's own maps app: Apple Maps on an iPhone, Google Maps on Android. The link
// comes from the server: to the customer's pin if they dropped one, otherwise to the written address.
function DirectionsLink({ url, label = '🧭 Directions' }: { url: string; label?: string }) {
  return (
    <a className="directions-link" href={mapsAppLink(url)} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  )
}

// Shows 071 234 5678 instead of +27712345678, and links it so the courier can tap to call.
function PhoneLink({ e164 }: { e164: string }) {
  const n = '0' + e164.slice(3)
  return (
    <a href={`tel:${e164}`} translate="no">
      {`${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`}
    </a>
  )
}

export function CourierPage() {
  const paymentTest = usePaymentTestMode()
  const [openJobs, setOpenJobs] = useState<OpenJob[] | null>(null)
  const [myJobs, setMyJobs] = useState<MyJob[] | null>(null)
  const [holdingCents, setHoldingCents] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [suspended, setSuspended] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  // While a delivery is on the go, the customer follows this phone's position on a map.
  const hasActiveJob = (myJobs ?? []).some((j) => j.status === 'claimed' || j.status === 'collected')
  const sharing = useLiveLocation(hasActiveJob)

  const load = useCallback(() => {
    // Open jobs are loaded on their own: a suspended courier gets 403 there (no NEW jobs),
    // but must still see and finish the jobs they already hold.
    const open = api<OpenJob[]>('/courier/jobs')
      .then((o) => {
        setSuspended(null)
        return o
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) {
          setSuspended(err.message)
          return []
        }
        throw err
      })
    Promise.all([open, api<MyJob[]>('/courier/my-jobs'), api<{ holdingCents: number }>('/courier/cash')])
      .then(([o, m, c]) => {
        setOpenJobs(o)
        setMyJobs(m)
        setHoldingCents(c.holdingCents)
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  async function claim(id: number) {
    setBusy(id)
    setError(null)
    try {
      // Customers follow their delivery on a map: taking a job switches location sharing on (the phone asks
      // once). If location is off or blocked the job is still taken - the order must still arrive - and the
      // banner above the job keeps saying how to turn it on.
      sharing.turnOn()
      await api(`/courier/jobs/${id}/claim`, { method: 'POST' })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not take the job. Please try again.')
    } finally {
      setBusy(null)
      load()
    }
  }

  if (!openJobs || !myJobs) {
    return (
      <main className="page">
        <h1 className="page-title">Deliveries</h1>
        {error ? <p className="notice error">{error}</p> : <div className="skeleton" style={{ minHeight: 240 }} aria-busy="true" />}
      </main>
    )
  }

  const active = myJobs.filter((j) => j.status === 'claimed' || j.status === 'collected')
  const done = myJobs.filter((j) => j.status === 'delivered')
  const returning = myJobs.filter((j) => j.status === 'failed')

  return (
    <main className="page">
      <h1 className="page-title">Deliveries</h1>

      <DocumentsNeeded />

      <section className="kpi-grid" aria-label="Your numbers" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <span className="kpi-label">Cash you’re holding</span>
          <span className={`kpi-value${holdingCents > 0 ? ' accent' : ''}`} translate="no">
            {formatRand(holdingCents)}
          </span>
          <span className="kpi-hint">Hand it to the seller</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Open jobs</span>
          <span className="kpi-value">{openJobs.length}</span>
          <span className="kpi-hint">Updates every 15 s</span>
        </div>
      </section>

      {error && (
        <p className="notice error" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}
      {suspended && (
        <p className="notice error" role="status" style={{ marginBottom: 12 }}>
          {suspended}
        </p>
      )}

      {active.length > 0 && (
        <section aria-labelledby="mine-heading" style={{ marginBottom: 20 }}>
          <div className="section-head">
            <h2 id="mine-heading">Your jobs</h2>
          </div>
          <LocationBanner state={sharing.state} onTurnOn={sharing.turnOn} />
          {active.map((j) => (
            <ActiveJob key={j.id} job={j} me={sharing.position} onChanged={load} />
          ))}
        </section>
      )}

      {returning.length > 0 && (
        <section aria-labelledby="return-heading" style={{ marginBottom: 20 }}>
          <div className="section-head">
            <h2 id="return-heading">Not delivered</h2>
          </div>
          {returning.map((j) => (
            <article className="card" key={j.id}>
              <div className="order-card-head">
                <strong translate="no">Order {j.orderNumber}</strong>
                <span className="status-pill bad">{j.failedReason ? FAIL_REASONS[j.failedReason] : 'Not delivered'}</span>
              </div>
              {j.orderStatus === 'delivery_failed' ? (
                <p className="notice" style={{ margin: '8px 0 0' }}>
                  Keep the goods safe. Support is deciding whether you deliver again or bring them back.
                </p>
              ) : (
                <div className="job-step">
                  <strong>Take the goods back to {j.business.name}</strong>
                  <span>{j.business.pickupAddress}</span>
                  {j.business.phone && <PhoneLink e164={j.business.phone} />}
                  <span className="fine-print">The order was cancelled. The seller confirms when they have the goods.</span>
                </div>
              )}
            </article>
          ))}
        </section>
      )}

      <section aria-labelledby="open-heading">
        <div className="section-head">
          <h2 id="open-heading">Open jobs</h2>
        </div>
        {openJobs.length === 0 ? (
          <p className="notice">No jobs right now. New jobs appear here when a seller marks a delivery order ready.</p>
        ) : (
          openJobs.map((j) => (
            <article className="card" key={j.id}>
              <div className="order-card-head">
                <strong>{j.businessArea}</strong>
                <span className="price" translate="no">
                  Fee {formatRand(j.feeCents)}
                </span>
              </div>
              <p className="product-meta" style={{ margin: '4px 0 0' }}>
                Collect from {j.businessName} · {j.itemCount} {j.itemCount === 1 ? 'item' : 'items'}
              </p>
              <p className="product-meta" style={{ margin: '2px 0 0' }}>
                {j.cashToCollectCents > 0 ? (
                  <>
                    Customer pays cash: <span translate="no">{formatRand(j.cashToCollectCents)}</span>
                  </>
                ) : paymentTest ? (
                  <strong>Paid online in test mode: no real money</strong>
                ) : (
                  'Already paid online'
                )}
              </p>
              <p className="fine-print">You’ll see the delivery address once the job is yours.</p>
              <button
                type="button"
                className="btn btn-primary btn-block"
                style={{ marginTop: 10 }}
                disabled={busy === j.id}
                onClick={() => claim(j.id)}
              >
                {busy === j.id ? 'Taking job…' : 'Take this job'}
              </button>
            </article>
          ))
        )}
      </section>

      {done.length > 0 && (
        <section aria-labelledby="done-heading" style={{ marginTop: 20 }}>
          <div className="section-head">
            <h2 id="done-heading">Delivered recently</h2>
          </div>
          {done.map((j) => (
            <article className="card" key={j.id}>
              <div className="order-card-head">
                <strong translate="no">Order {j.orderNumber}</strong>
                <span className="status-pill good">Delivered</span>
              </div>
              <p className="product-meta" style={{ margin: '4px 0 0' }}>
                {j.business.name} · Fee <span translate="no">{formatRand(j.feeCents)}</span>
                {j.cashToCollectCents > 0 && (
                  <>
                    {' '}
                    · Cash <span translate="no">{formatRand(j.cashToCollectCents)}</span>:{' '}
                    {j.cashStatus === 'remitted'
                      ? 'handed to seller'
                      : j.cashStatus === 'disputed'
                        ? 'amount disputed'
                        : 'still with you'}
                  </>
                )}
              </p>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}

interface CourierDocuments {
  outstanding: string[] // e.g. ["police_clearance"]
  due: string | null // YYYY-MM-DD
  overdue: boolean
  waitingForSupport: string[] // sent, not checked yet
  lastRejectedReason: string | null
}

// "Documents needed": what an approved courier still has to send - the police clearance certificate if
// they applied with proof of applying (30 days), or everything if they were approved before checks began
// (14 days). After the due date they can't take NEW jobs until support has checked what they sent.
function DocumentsNeeded() {
  const [docs, setDocs] = useState<CourierDocuments | null>(null)
  const [maxBytes, setMaxBytes] = useState(5 * 1024 * 1024)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<CourierDocuments>('/courier/documents')
      .then(setDocs)
      .catch(() => setDocs(null))
  }, [])

  useEffect(() => {
    load()
    api<{ maxIdDocumentBytes: number }>('/config')
      .then((c) => setMaxBytes(c.maxIdDocumentBytes))
      .catch(() => {})
  }, [load])

  async function send(kind: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(kind)
    setError(null)
    try {
      const chosen = await readDocument(file, maxBytes)
      await api(`/courier/documents/${kind}`, { method: 'POST', body: { file: chosen.base64 } })
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(null)
      e.target.value = ''
    }
  }

  if (!docs || docs.outstanding.length === 0) return null

  const dueText = docs.due ? new Date(`${docs.due}T12:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }) : null
  const allSent = docs.outstanding.every((k) => docs.waitingForSupport.includes(k))

  return (
    <section className="card" aria-labelledby="documents-heading" style={{ marginBottom: 16 }}>
      <h2 id="documents-heading" style={{ marginTop: 0 }}>
        Documents needed
      </h2>
      {allSent ? (
        <p className="product-meta">Thank you – support is checking what you sent. We’ll let you know here.</p>
      ) : (
        <p className={docs.overdue ? 'notice error' : 'product-meta'}>
          {docs.overdue
            ? `These were due on ${dueText}. You can finish the jobs you have, but you can’t take new ones until support has checked them.`
            : `Please send ${docs.outstanding.length === 1 ? 'this' : 'these'} by ${dueText}. After that you can’t take new jobs until support has checked ${docs.outstanding.length === 1 ? 'it' : 'them'}.`}
        </p>
      )}
      {docs.lastRejectedReason && !allSent && (
        <p className="notice error" style={{ marginTop: 8 }}>
          The last ones couldn’t be accepted: “{docs.lastRejectedReason}” Please send them again.
        </p>
      )}
      {docs.outstanding.map((kind) => (
        <div key={kind} className="field" style={{ marginTop: 8 }}>
          <label htmlFor={`doc-${kind}`}>
            {kind === 'police_clearance' ? 'Police clearance certificate (from SAPS)' : DOCUMENT_LABEL[kind]}
          </label>
          {docs.waitingForSupport.includes(kind) && <p className="fine-print">✓ Sent – support is checking it. Choose a file again to replace it.</p>}
          <input id={`doc-${kind}`} type="file" accept="image/*,application/pdf" onChange={(e) => send(kind, e)} disabled={busy !== null} />
          {busy === kind && <p className="fine-print">Sending…</p>}
        </div>
      ))}
      {error && <p className="field-error">{error}</p>}
      <p className="fine-print" style={{ marginTop: 8 }}>
        A clear photo or a PDF, 5 MB at most. Kept encrypted, seen only by support, and deleted 30 days after they’re checked. Please don’t send documents by email.
      </p>
    </section>
  )
}

// Is the customer seeing where I am? Shown above the courier's jobs.
function LocationBanner({ state, onTurnOn }: { state: Sharing; onTurnOn: () => void }) {
  if (state === 'on') {
    return (
      <p className="notice success" role="status" style={{ marginBottom: 12 }}>
        📍 Your customer can see where you are while you deliver. Keep this page open – the screen stays on.
      </p>
    )
  }
  if (state === 'blocked' || state === 'unavailable') {
    return (
      <p className="notice error" role="alert" style={{ marginBottom: 12 }}>
        📍{' '}
        {state === 'blocked'
          ? 'Location is blocked, so your customer can’t see you coming. Allow location for this website in your browser’s settings (iPhone: Settings > Privacy & Security > Location Services > Safari Websites > While Using), then reload the page.'
          : 'Your phone can’t find its location. Check that location (GPS) is on.'}
      </p>
    )
  }
  return (
    <div className="notice" style={{ marginBottom: 12 }}>
      <p style={{ margin: '0 0 8px' }}>📍 {state === 'starting' ? 'Finding your location…' : 'Share your location so your customer can follow the delivery.'}</p>
      {state === 'off' && (
        <button type="button" className="btn btn-primary" onClick={onTurnOn}>
          Share my location
        </button>
      )}
    </div>
  )
}

function ActiveJob({ job: j, me, onChanged }: { job: MyJob; me: Point | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [failing, setFailing] = useState(false)
  const [failReason, setFailReason] = useState('')
  const [toldOutside, setToldOutside] = useState(false)
  const [navigating, setNavigating] = useState(false) // directions to the customer open in the app
  const customerFirstName = j.customer?.name.split(' ')[0] ?? 'the customer'
  const vehicleEmoji = VEHICLE_EMOJI[j.vehicleType] ?? '🛵'
  const quickReplies = ['I’m on my way', 'I’m at the gate', 'I can’t find the house – please call me']

  // "I'm outside": a message in the chat and an SMS to the customer.
  async function tellOutside() {
    setBusy(true)
    setError(null)
    try {
      await api(`/courier/jobs/${j.id}/outside`, { method: 'POST' })
      setToldOutside(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function act(path: string, body?: unknown) {
    setBusy(true)
    setError(null)
    try {
      await api(`/courier/jobs/${j.id}/${path}`, { method: 'POST', body: body ?? {} })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const items = j.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')

  return (
    <article className="card order-card">
      <div className="order-card-head">
        <strong translate="no">Order {j.orderNumber}</strong>
        <span className={`status-pill ${j.status === 'claimed' ? 'wait' : 'good'}`}>
          {j.status === 'claimed' ? 'Go and collect' : 'On the way'}
        </span>
      </div>
      <p className="order-card-items">{items}</p>

      {j.status === 'claimed' && (
        <>
          <div className="job-step">
            <strong>1. Collect from {j.business.name}</strong>
            <span>{j.business.pickupAddress}</span>
            {j.business.phone && <PhoneLink e164={j.business.phone} />}
            {j.business.directionsUrl && <DirectionsLink url={j.business.directionsUrl} />}
          </div>
          <DeliveryChat orderId={j.orderId} otherName={customerFirstName} unread={j.unreadMessages} quickReplies={quickReplies} />
          {j.releasedBySeller ? (
            <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => act('collect')}>
              {busy ? 'Saving…' : 'I’ve collected the order'}
            </button>
          ) : (
            <p className="notice" style={{ marginTop: 10 }}>
              When you arrive, the seller taps <strong>Hand over</strong> on their phone. Then you can confirm you’ve
              collected it.
            </p>
          )}
        </>
      )}

      {j.status === 'collected' && j.customer && (
        <>
          <div className="job-step">
            <strong>2. Deliver to {j.customer.name}</strong>
            <span>{j.customer.address}</span>
            <PhoneLink e164={j.customer.phone} />
            {j.customer.notes && <span className="fine-print">Note: {j.customer.notes}</span>}
            {j.customer.location ? (
              !navigating && (
                <div className="directions-row">
                  <button type="button" className="directions-link primary" onClick={() => setNavigating(true)}>
                    🧭 Directions in the app
                  </button>
                  <DirectionsLink url={j.customer.directionsUrl} label="🗺️ Maps app" />
                </div>
              )
            ) : (
              <DirectionsLink url={j.customer.directionsUrl} />
            )}
          </div>
          {j.customer.location && navigating ? (
            <InAppDirections
              jobId={j.id}
              me={me}
              destination={j.customer.location}
              customerName={customerFirstName}
              vehicleEmoji={vehicleEmoji}
              onClose={() => setNavigating(false)}
            />
          ) : j.customer.location ? (
            <MapView
              label={`Map with the place ${j.customer.name} pinned for the delivery, and you`}
              centre={j.customer.location}
              height={220}
              pins={[
                { id: 'home', ...j.customer.location, emoji: '🏠', label: `${j.customer.name}: deliver here` },
                ...(me ? [{ id: 'me', lat: me.lat, lng: me.lng, emoji: vehicleEmoji, label: 'You' } satisfies MapPin] : []),
              ]}
            />
          ) : (
            <p className="fine-print">No map pin for this order: use the address, and call if you can’t find it.</p>
          )}
          <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 10 }} disabled={busy} onClick={tellOutside}>
            📍 I’m outside
          </button>
          {toldOutside && (
            <p className="fine-print" role="status">
              ✓ {customerFirstName} got a message and an SMS that you’re outside.
            </p>
          )}
          <DeliveryChat orderId={j.orderId} otherName={customerFirstName} unread={j.unreadMessages} quickReplies={quickReplies} />
          <CallButton target={{ orderId: j.orderId, with: 'customer' }} label={`📞 Call ${customerFirstName} free`} />
          {j.cashToCollectCents > 0 && (
            <p className="notice" style={{ marginTop: 10 }}>
              Collect <strong translate="no">{formatRand(j.cashToCollectCents)}</strong> cash from the customer.
            </p>
          )}
          <form
            className="pickup-form"
            onSubmit={(e) => {
              e.preventDefault()
              act('deliver', { code })
            }}
          >
            <CodeScanButton
              onCode={(scanned) => {
                setCode(scanned)
                act('deliver', { code: scanned })
              }}
            />
            <label htmlFor={`dcode-${j.id}`}>Customer’s delivery code</label>
            <p className="fine-print" style={{ marginTop: 0 }}>
              The customer opens their order and shows you a 6-digit code.
            </p>
            <div className="btn-row">
              <div className="input-wrap">
                <input
                  id={`dcode-${j.id}`}
                  className="code-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
                {busy ? 'Checking…' : 'Complete delivery'}
              </button>
            </div>
          </form>
          {/* Spec FR-15: a failed handover goes to support - it is never marked as delivered. */}
          {!failing ? (
            <button type="button" className="link-btn" style={{ marginTop: 10 }} onClick={() => setFailing(true)}>
              Couldn’t deliver?
            </button>
          ) : (
            <fieldset className="choice-group" style={{ marginTop: 12 }}>
              <legend>What happened? Keep the goods – support will tell you what to do next.</legend>
              <div className="reason-list">
                {Object.entries(FAIL_REASONS).map(([value, label]) => (
                  <label key={value} className="choice">
                    <input type="radio" name={`fail-${j.id}`} checked={failReason === value} onChange={() => setFailReason(value)} />
                    {label}
                  </label>
                ))}
              </div>
              <div className="btn-row">
                <button type="button" className="btn btn-danger" disabled={busy || !failReason} onClick={() => act('fail', { reason: failReason })}>
                  Report not delivered
                </button>
                <button type="button" className="btn btn-outline" onClick={() => setFailing(false)}>
                  Back
                </button>
              </div>
            </fieldset>
          )}
        </>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </article>
  )
}
