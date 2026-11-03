import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { VEHICLE_LABEL, dateTime } from '../lib/labels'
import { shrinkPhoto } from '../lib/photos'

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
  maxIdDocumentBytes: number
}

interface IdDocument {
  name: string
  base64: string
  bytes: number
}

// A photo of the ID is shrunk on the phone first (it uploads quicker on mobile data and loses hidden
// details such as the location); a PDF goes as it is. Sent as base64 text inside the application.
async function readIdDocument(file: File, maxBytes: number): Promise<IdDocument> {
  const blob = file.type === 'application/pdf' ? file : await shrinkPhoto(file, { maxSide: 2000, quality: 0.85 })
  if (blob.size > maxBytes) throw new Error('That file is too big: 5 MB at most.')
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(new Error('That file could not be read. Please try another one.'))
    reader.readAsDataURL(blob)
  })
  return { name: file.name, base64, bytes: blob.size }
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
          {dateTime(application.createdAt)}. Support will check your details
          {application.type === 'seller' ? ' and ID document' : ''}, and may phone or email you.
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
  const [form, setForm] = useState<Form>({ area: '', vehicleType: '', businessName: '', pickupAddress: '', phone: '', description: '', kind: 'shop', email: '' })
  const stall = form.kind === 'market_stall'
  const [idDocument, setIdDocument] = useState<IdDocument | null>(null)
  const [reading, setReading] = useState(false)
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreePrivacy, setAgreePrivacy] = useState(false)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))
  const err = (k: string) => (fields[k] ? <p className="field-error">{fields[k]}</p> : null)

  async function chooseIdDocument(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setReading(true)
    setFields(({ idDocument: _gone, ...rest }) => rest)
    try {
      setIdDocument(await readIdDocument(file, policy.maxIdDocumentBytes))
    } catch (err) {
      setIdDocument(null)
      setFields((f) => ({ ...f, idDocument: err instanceof Error ? err.message : 'That file could not be read.' }))
    } finally {
      setReading(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setFields({})
    try {
      const verification = type === 'seller' ? { idDocument: idDocument?.base64 ?? '', agreeTerms, agreePrivacy } : {}
      await api('/applications', { method: 'POST', body: { type, ...form, ...verification } })
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
            <fieldset className="choice-group">
              <legend>What are you registering?</legend>
              <div className="choices">
                <label className="choice">
                  <input type="radio" name="kind" checked={!stall} onChange={() => setForm((f) => ({ ...f, kind: 'shop' }))} />
                  My own shop or business
                </label>
                <label className="choice">
                  <input type="radio" name="kind" checked={stall} onChange={() => setForm((f) => ({ ...f, kind: 'market_stall' }))} />
                  A market stall (I’m helping someone)
                </label>
              </div>
              {stall && (
                <p className="fine-print">
                  You manage the listing for them. The stall holder gets each order by SMS on their own phone, even a basic
                  one, and answers by SMS.
                </p>
              )}
            </fieldset>
            <div className="field" data-invalid={Boolean(fields.businessName)}>
              <label htmlFor="businessName">{stall ? 'Stall name (e.g. “Mma Kefilwe’s Vegetables”)' : 'Business name'}</label>
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
              <label htmlFor="pickupAddress">{stall ? 'Where the stall is (e.g. “Main Street, by the taxi rank”)' : 'Where customers collect orders'}</label>
              <div className="input-wrap">
                <input id="pickupAddress" value={form.pickupAddress} onChange={set('pickupAddress')} maxLength={200} />
              </div>
              {err('pickupAddress')}
            </div>
            <div className="field" data-invalid={Boolean(fields.phone)}>
              <label htmlFor="bizPhone">{stall ? 'The stall holder’s phone (gets the orders by SMS)' : 'Business phone number'}</label>
              <div className="input-wrap">
                <input id="bizPhone" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} placeholder="071 234 5678" />
              </div>
              {err('phone')}
            </div>

            <h3 className="form-subhead">Verify who you are</h3>
            <p className="fine-print" style={{ marginTop: 0 }}>
              Like a payment service, we check every seller before they can sell, so customers can trust the shops here.
            </p>
            <div className="field" data-invalid={Boolean(fields.email)}>
              <label htmlFor="email">Your email address</label>
              <div className="input-wrap">
                <input id="email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={set('email')} maxLength={120} placeholder="name@gmail.com" />
              </div>
              {err('email')}
            </div>
            <div className="field" data-invalid={Boolean(fields.idDocument)}>
              <label htmlFor="idDocument">A copy of your ID document</label>
              <p className="fine-print" style={{ marginTop: 0 }}>
                A clear photo of your ID book page or smart ID card (the side with your photo and ID number), or a PDF.
                It is stored encrypted, only the support team can open it, and it is deleted 30 days after your
                application is decided.
              </p>
              <input id="idDocument" type="file" accept="image/*,application/pdf" onChange={chooseIdDocument} />
              {reading && <p className="fine-print">Preparing your file…</p>}
              {idDocument && !reading && (
                <p className="fine-print">
                  ✓ {idDocument.name} ({Math.max(1, Math.round(idDocument.bytes / 1024))} KB) is ready to send.
                </p>
              )}
              {err('idDocument')}
            </div>
            <div className="field" data-invalid={Boolean(fields.agreeTerms)}>
              <label className="choice consent">
                <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
                <span>
                  I have read and accept the{' '}
                  <Link to="/seller-terms" target="_blank">
                    seller terms
                  </Link>
                  .
                </span>
              </label>
              {err('agreeTerms')}
            </div>
            <div className="field" data-invalid={Boolean(fields.agreePrivacy)}>
              <label className="choice consent">
                <input type="checkbox" checked={agreePrivacy} onChange={(e) => setAgreePrivacy(e.target.checked)} />
                <span>
                  I have read the{' '}
                  <Link to="/privacy" target="_blank">
                    privacy notice
                  </Link>{' '}
                  and agree that KurumanMarketPlace uses my ID document and email to verify me and to contact me about my
                  application (POPIA).
                </span>
              </label>
              {err('agreePrivacy')}
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
          <button type="submit" className="btn btn-primary" disabled={busy || reading}>
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
