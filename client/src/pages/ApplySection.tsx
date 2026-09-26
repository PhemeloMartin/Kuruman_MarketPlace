import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { VEHICLE_LABEL, dateTime } from '../lib/labels'

interface Application {
  id: number
  type: 'seller' | 'courier'
  status: 'open' | 'closed'
  resolution: 'approved' | 'rejected' | null
  reason: string | null
  details: Record<string, string>
  createdAt: string
}

interface Policy {
  serviceAreas: string[]
  vehicleTypes: string[]
}

type Form = Record<string, string>

// "Sell or deliver with us" (spec FR-02). This only sends an application to support;
// the account stays a customer account until support approves it.
export function ApplySection() {
  const [application, setApplication] = useState<Application | null | undefined>(undefined)
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [applying, setApplying] = useState<'seller' | 'courier' | null>(null)

  const load = useCallback(() => {
    api<{ application: Application | null }>('/applications/mine')
      .then((r) => setApplication(r.application))
      .catch(() => setApplication(null))
  }, [])

  useEffect(() => {
    load()
    api<Policy>('/config').then(setPolicy).catch(() => {})
  }, [load])

  if (application === undefined || !policy) return null

  if (application?.status === 'open') {
    return (
      <section className="card">
        <strong>Your application is being reviewed</strong>
        <p className="product-meta" style={{ margin: '4px 0 0' }}>
          You applied to {application.type === 'seller' ? `sell as “${application.details.businessName}”` : 'deliver'} on{' '}
          {dateTime(application.createdAt)}. Support will check your details and may phone you.
        </p>
      </section>
    )
  }

  if (applying) {
    return (
      <ApplyForm
        type={applying}
        policy={policy}
        onCancel={() => setApplying(null)}
        onDone={() => {
          setApplying(null)
          load()
        }}
      />
    )
  }

  return (
    <section className="card">
      {application?.resolution === 'rejected' && (
        <p className="notice error" style={{ marginBottom: 12 }}>
          Your application to {application.type === 'seller' ? 'sell' : 'deliver'} wasn’t approved: “{application.reason}”.
          You can apply again.
        </p>
      )}
      <strong>Sell or deliver with KurumanMarketPlace</strong>
      <p className="product-meta" style={{ margin: '4px 0 12px' }}>
        Local businesses and couriers are checked by our support team before they start.
      </p>
      <div className="btn-row">
        <button type="button" className="btn btn-outline" onClick={() => setApplying('seller')}>
          Apply to sell
        </button>
        <button type="button" className="btn btn-outline" onClick={() => setApplying('courier')}>
          Apply to deliver
        </button>
      </div>
    </section>
  )
}

function ApplyForm({ type, policy, onCancel, onDone }: { type: 'seller' | 'courier'; policy: Policy; onCancel: () => void; onDone: () => void }) {
  const [form, setForm] = useState<Form>({ area: '', vehicleType: '', businessName: '', pickupAddress: '', phone: '', description: '' })
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))
  const err = (k: string) => (fields[k] ? <p className="field-error">{fields[k]}</p> : null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setFields({})
    try {
      await api('/applications', { method: 'POST', body: { type, ...form } })
      onDone()
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else setError('Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2 style={{ fontSize: '1.1rem' }}>{type === 'seller' ? 'Apply to sell' : 'Apply to deliver'}</h2>
      <form className="form" onSubmit={submit} noValidate>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {type === 'seller' && (
          <>
            <div className="field" data-invalid={Boolean(fields.businessName)}>
              <label htmlFor="businessName">Business name</label>
              <div className="input-wrap">
                <input id="businessName" value={form.businessName} onChange={set('businessName')} maxLength={100} />
              </div>
              {err('businessName')}
            </div>
            <div className="field" data-invalid={Boolean(fields.description)}>
              <label htmlFor="bizDescription">What do you sell? (optional)</label>
              <div className="input-wrap">
                <textarea id="bizDescription" rows={2} value={form.description} onChange={set('description')} maxLength={500} />
              </div>
              {err('description')}
            </div>
          </>
        )}
        <div className="field" data-invalid={Boolean(fields.area)}>
          <label htmlFor="area">Area</label>
          <div className="input-wrap">
            <select id="area" className="select" value={form.area} onChange={set('area')}>
              <option value="">Choose…</option>
              {policy.serviceAreas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          {err('area')}
        </div>
        {type === 'seller' ? (
          <>
            <div className="field" data-invalid={Boolean(fields.pickupAddress)}>
              <label htmlFor="pickupAddress">Where customers collect orders</label>
              <div className="input-wrap">
                <input id="pickupAddress" value={form.pickupAddress} onChange={set('pickupAddress')} maxLength={200} />
              </div>
              {err('pickupAddress')}
            </div>
            <div className="field" data-invalid={Boolean(fields.phone)}>
              <label htmlFor="bizPhone">Business phone number</label>
              <div className="input-wrap">
                <input id="bizPhone" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} placeholder="071 234 5678" />
              </div>
              {err('phone')}
            </div>
          </>
        ) : (
          <div className="field" data-invalid={Boolean(fields.vehicleType)}>
            <label htmlFor="vehicleType">How will you deliver?</label>
            <div className="input-wrap">
              <select id="vehicleType" className="select" value={form.vehicleType} onChange={set('vehicleType')}>
                <option value="">Choose…</option>
                {policy.vehicleTypes.map((v) => (
                  <option key={v} value={v}>
                    {VEHICLE_LABEL[v]}
                  </option>
                ))}
              </select>
            </div>
            {err('vehicleType')}
          </div>
        )}
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Sending…' : 'Send application'}
          </button>
          <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  )
}
