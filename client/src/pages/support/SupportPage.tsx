import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useAuth } from '../../auth/AuthContext'
import { api, ApiError } from '../../lib/api'
import type { StaffScope } from '../../lib/types'
import { AccountsTab } from './AccountsTab'
import { ApplicationsTab } from './ApplicationsTab'
import { AuditTab } from './AuditTab'
import { MoneyTab } from './MoneyTab'
import { OperationsTab } from './OperationsTab'
import { PrivacyTab } from './PrivacyTab'

// Restricted support console (spec UI-13). The server checks every request again - these
// screens only decide what to show.
export function SupportPage() {
  const { user } = useAuth()
  if (!user) return null
  return (
    <main className="page">
      <p className="eyebrow">Restricted</p>
      <h1 className="page-title" style={{ marginTop: 0 }}>
        Support console
      </h1>
      {user.mfaVerified ? <Console scopes={user.staffScopes} /> : <MfaStep />}
    </main>
  )
}

// ---------------------------------------------------------------------------
// Second sign-in step
// ---------------------------------------------------------------------------

function MfaStep() {
  const { refresh } = useAuth()
  const [enrolled, setEnrolled] = useState<boolean | null>(null)
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ enrolled: boolean }>('/support/mfa')
      .then((r) => setEnrolled(r.enrolled))
      .catch((err) => setError(err.message))
  }, [])

  async function startSetup() {
    setError(null)
    try {
      const r = await api<{ secret: string; otpauthUrl: string }>('/support/mfa/setup', { method: 'POST' })
      // The QR code is drawn here in the browser; the secret isn't sent to any other service.
      setSetup({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauthUrl, { margin: 1, width: 200 }) })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start set-up.')
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/support/mfa/verify', { method: 'POST', body: { code } })
      await refresh() // the server now reports this session as verified
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check the code.')
      setCode('')
      setBusy(false)
    }
  }

  if (enrolled === null) {
    return error ? <p className="notice error">{error}</p> : <div className="skeleton" style={{ minHeight: 200 }} />
  }

  const codeForm = (
    <form className="form" onSubmit={verify} noValidate>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="field">
        <label htmlFor="mfa-code">6-digit code from your authenticator app</label>
        <div className="input-wrap">
          <input
            id="mfa-code"
            className="code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </div>
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>
        {busy ? 'Checking…' : 'Continue'}
      </button>
    </form>
  )

  if (enrolled) {
    return (
      <section className="card">
        <h2 style={{ fontSize: '1.1rem' }}>Confirm it’s you</h2>
        <p className="product-meta" style={{ margin: '4px 0 12px' }}>
          Support can see people’s details and make money decisions, so a passphrase alone isn’t enough.
        </p>
        {codeForm}
      </section>
    )
  }

  return (
    <section className="card">
      <h2 style={{ fontSize: '1.1rem' }}>Set up your authenticator app</h2>
      <p className="product-meta" style={{ margin: '4px 0 12px' }}>
        Support staff sign in with their passphrase <em>and</em> a code from an app such as Google Authenticator or
        Microsoft Authenticator. You only do this once.
      </p>
      {!setup ? (
        <>
          {error && <p className="notice error">{error}</p>}
          <button type="button" className="btn btn-primary btn-block" onClick={startSetup}>
            Start set-up
          </button>
        </>
      ) : (
        <>
          <ol className="setup-steps">
            <li>In the app, tap <strong>+</strong> and scan this code:</li>
          </ol>
          <img src={setup.qr} alt="QR code for your authenticator app" width={200} height={200} className="mfa-qr" />
          <p className="fine-print">
            Can’t scan? Choose “Enter a setup key” and type:{' '}
            <code className="mfa-key" translate="no">
              {setup.secret.match(/.{1,4}/g)?.join(' ')}
            </code>
          </p>
          <ol className="setup-steps" start={2}>
            <li>Enter the 6-digit code the app shows:</li>
          </ol>
          {codeForm}
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// The console: one tab per kind of work this staff member is allowed to do
// ---------------------------------------------------------------------------

const TABS: { key: string; label: string; scope: StaffScope }[] = [
  { key: 'applications', label: 'Applications', scope: 'approvals' },
  { key: 'accounts', label: 'Accounts', scope: 'approvals' },
  { key: 'money', label: 'Money', scope: 'payments' },
  { key: 'deliveries', label: 'Deliveries', scope: 'operations' },
  { key: 'privacy', label: 'Privacy', scope: 'privacy' },
  { key: 'audit', label: 'Audit', scope: 'audit' },
]

function Console({ scopes }: { scopes: StaffScope[] }) {
  const tabs = TABS.filter((t) => scopes.includes(t.scope))
  const [tab, setTab] = useState(tabs[0]?.key)

  if (tabs.length === 0) return <p className="notice">Your support account has no work areas assigned yet.</p>

  return (
    <>
      <div className="chips" role="tablist" aria-label="Support work" style={{ marginBottom: 14 }}>
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" className="chip" aria-selected={tab === t.key} aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'applications' && <ApplicationsTab />}
      {tab === 'accounts' && <AccountsTab />}
      {tab === 'money' && <MoneyTab />}
      {tab === 'deliveries' && <OperationsTab />}
      {tab === 'privacy' && <PrivacyTab />}
      {tab === 'audit' && <AuditTab />}
    </>
  )
}
