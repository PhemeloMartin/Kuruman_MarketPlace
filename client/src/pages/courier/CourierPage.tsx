import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { formatRand } from '../../lib/money'

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
  status: 'claimed' | 'collected' | 'delivered' | 'failed'
  orderNumber: string
  feeCents: number
  cashToCollectCents: number
  cashStatus: 'collected' | 'remitted' | 'disputed' | null
  releasedBySeller: boolean
  business: { name: string; area: string; pickupAddress: string | null; phone: string | null }
  customer: { name: string; phone: string; address: string; notes: string | null } | null
  items: { name: string; quantity: number }[]
}

const REFRESH_MS = 15_000

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
  const [openJobs, setOpenJobs] = useState<OpenJob[] | null>(null)
  const [myJobs, setMyJobs] = useState<MyJob[] | null>(null)
  const [holdingCents, setHoldingCents] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [suspended, setSuspended] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

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

  return (
    <main className="page">
      <h1 className="page-title">Deliveries</h1>

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
          {active.map((j) => (
            <ActiveJob key={j.id} job={j} onChanged={load} />
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

function ActiveJob({ job: j, onChanged }: { job: MyJob; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState('')

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
          </div>
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
          </div>
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
