import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { api, ApiError } from '../lib/api'
import { dateTime } from '../lib/labels'

interface PrivacyRequest {
  id: number
  type: 'access' | 'correction' | 'deletion'
  status: 'open' | 'closed'
  resolution: string | null
  reason: string | null
  dueAt: string | null
  createdAt: string
}

type Mode = null | 'name' | 'download' | 'correction' | 'close'

const TYPE_LABEL = { access: 'Data download', correction: 'Correction', deletion: 'Close account' }

// "Your information" on the Profile page (spec FR-20, UI-12): see, correct, or close.
export function PrivacySection() {
  const { user, refresh } = useAuth()
  const [requests, setRequests] = useState<PrivacyRequest[]>([])
  const [mode, setMode] = useState<Mode>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  // Downloading or closing needs a fresh SMS code, to confirm it's really you holding the phone.
  const [demoCode, setDemoCode] = useState<string | null>(null) // only in demo mode (no SMS gateway yet)

  const load = useCallback(() => {
    api<PrivacyRequest[]>('/privacy/requests')
      .then(setRequests)
      .catch(() => setRequests([]))
  }, [])
  useEffect(load, [load])

  function open(m: Mode) {
    setMode(m)
    setValue(m === 'name' ? (user?.displayName ?? '') : '')
    setError(null)
    setDone(null)
    setDemoCode(null)
    if (m === 'download' || m === 'close') sendCode()
  }

  async function sendCode() {
    try {
      const r = await api<{ demoCode?: string }>('/privacy/confirm-code', { method: 'POST' })
      setDemoCode(r.demoCode ?? null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We couldn’t send a code. Please try again.')
    }
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'name') {
        await api('/privacy/profile', { method: 'PATCH', body: { displayName: value } })
        await refresh()
        setDone('Your name is updated.')
      } else if (mode === 'download') {
        const data = await api<unknown>('/privacy/export', { method: 'POST', body: { code: value } })
        // Build the file here in the browser - nothing is stored on the phone afterwards.
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'my-kurumanmarketplace-data.json'
        a.click()
        URL.revokeObjectURL(url)
        setDone('Your information was downloaded.')
      } else if (mode === 'correction') {
        await api('/privacy/requests', { method: 'POST', body: { type: 'correction', details: value } })
        setDone('Sent. Support will reply within 2 business days.')
      } else if (mode === 'close') {
        await api('/privacy/requests', { method: 'POST', body: { type: 'deletion', code: value } })
        setDone('Request sent. Support will check nothing is still in progress, then close your account.')
      }
      setMode(null)
      load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const needsCode = mode === 'download' || mode === 'close'

  return (
    <section className="card">
      <strong>Your information</strong>
      <p className="product-meta" style={{ margin: '4px 0 10px' }}>
        <Link to="/privacy">How we use your information</Link>
      </p>

      {done && (
        <p className="notice" role="status" style={{ marginBottom: 10 }}>
          {done}
        </p>
      )}

      {mode ? (
        <div className="field">
          <label htmlFor="privacy-input">
            {mode === 'name'
              ? 'Your name'
              : mode === 'correction'
                ? 'What should we correct?'
                : 'Enter the code we sent you by SMS, to confirm it’s you'}
          </label>
          {needsCode && demoCode && (
            <p className="fine-print" style={{ marginTop: 0 }}>
              <strong>Demo mode:</strong> no SMS is sent yet. Your code is{' '}
              <strong className="demo-code" translate="no">
                {demoCode}
              </strong>
            </p>
          )}
          {mode === 'close' && (
            <p className="fine-print" style={{ marginTop: 0 }}>
              We remove your phone number, name and addresses. Orders and payments stay as “Closed account”
              for the sellers’ records.
            </p>
          )}
          <div className="input-wrap">
            {mode === 'correction' ? (
              <textarea id="privacy-input" rows={3} maxLength={500} value={value} onChange={(e) => setValue(e.target.value)} />
            ) : (
              <input
                id="privacy-input"
                className={needsCode ? 'code-input' : undefined}
                inputMode={needsCode ? 'numeric' : 'text'}
                autoComplete={needsCode ? 'one-time-code' : 'name'}
                maxLength={needsCode ? 6 : 80}
                value={value}
                onChange={(e) => setValue(needsCode ? e.target.value.replace(/\D/g, '') : e.target.value)}
              />
            )}
          </div>
          {error && <p className="field-error">{error}</p>}
          {needsCode && (
            <button type="button" className="link-btn" style={{ marginTop: 8 }} onClick={sendCode}>
              Send a new code
            </button>
          )}
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button type="button" className={`btn ${mode === 'close' ? 'btn-danger' : 'btn-primary'}`} disabled={busy || !value.trim()} onClick={submit}>
              {busy ? 'Please wait…' : mode === 'download' ? 'Download' : mode === 'close' ? 'Ask to close' : 'Save'}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="privacy-actions">
          <button type="button" className="link-btn" onClick={() => open('download')}>
            Download my information
          </button>
          <button type="button" className="link-btn" onClick={() => open('name')}>
            Change my name
          </button>
          <button type="button" className="link-btn" onClick={() => open('correction')}>
            Ask to correct something else
          </button>
          <button type="button" className="link-btn danger-link" onClick={() => open('close')}>
            Close my account
          </button>
        </div>
      )}

      {requests.length > 0 && (
        <ul className="case-notes" style={{ marginTop: 12 }}>
          {requests.slice(0, 5).map((r) => (
            <li key={r.id}>
              <strong>{TYPE_LABEL[r.type]}</strong> · {dateTime(r.createdAt)} ·{' '}
              {r.status === 'open'
                ? `being handled (by ${r.dueAt ? dateTime(r.dueAt) : '30 days'})`
                : r.resolution === 'held'
                  ? `on hold: “${r.reason}”`
                  : 'done'}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
