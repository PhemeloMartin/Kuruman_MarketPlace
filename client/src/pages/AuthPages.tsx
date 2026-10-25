import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import type { CodeSent } from '../auth/AuthContext'
import { MokalaScene } from '../components/Art'
import { ApiError } from '../lib/api'
import type { Role } from '../lib/types'

// After signing in, go back to where the user was heading (e.g. the cart), otherwise Home.
function useReturnTo(): string {
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  return from && from.startsWith('/') ? from : '/'
}

// Everyone signs in the same way; the server says what the account may do (its role), and we take
// the person to their own work area. A seller doesn't pick "seller" anywhere - that would be a
// choice the browser could fake, and an easy one to get wrong.
const HOME_FOR_ROLE: Record<Role, string> = {
  consumer: '/',
  entrepreneur: '/seller',
  courier: '/courier',
  support: '/support',
}

function Field(props: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <div className="input-wrap">{props.children}</div>
    </div>
  )
}

function PassphraseInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false)
  return (
    <>
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="current-password"
        required
        maxLength={128}
      />
      <button type="button" className="link-btn" onClick={() => setShow((s) => !s)} aria-pressed={show}>
        {show ? 'Hide' : 'Show'}
      </button>
    </>
  )
}

// Sign in and sign up are one page, like WhatsApp: phone number -> SMS code -> (new numbers only) name.
// One question per screen, nothing to remember, and the person can always go back a step.
type Step = 'phone' | 'code' | 'name' | 'staff'

export function SignInPage() {
  const { requestCode, verifyCode, staffLogin } = useAuth()
  const navigate = useNavigate()
  const returnTo = useReturnTo()
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [sent, setSent] = useState<CodeSent | null>(null)
  const [waitSeconds, setWaitSeconds] = useState(0) // until "Send a new code" works again
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Counts down the seconds before a new code may be asked for.
  useEffect(() => {
    if (waitSeconds <= 0) return
    const t = setTimeout(() => setWaitSeconds((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [waitSeconds])

  function goTo(role: Role) {
    // Heading somewhere specific (e.g. the cart)? Go there. Otherwise, to this account's own area.
    navigate(returnTo !== '/' ? returnTo : HOME_FOR_ROLE[role], { replace: true })
  }

  function show(next: Step) {
    setError(null)
    setStep(next)
  }

  // Runs one server call with a busy state and a plain-language error message.
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const sendCode = () =>
    run(async () => {
      const r = await requestCode(phone)
      setSent(r)
      setCode('')
      setWaitSeconds(r.resendAfterSeconds)
      setStep('code')
    })

  const checkCode = (typed: string) =>
    run(async () => {
      const r = await verifyCode(phone, typed)
      if ('user' in r) goTo(r.user.role)
      else setStep('name')
    })

  const createAccount = () =>
    run(async () => {
      const r = await verifyCode(phone, code, name)
      if ('user' in r) goTo(r.user.role)
    })

  const signInStaff = () =>
    run(async () => {
      const user = await staffLogin(phone, passphrase)
      goTo(user.role)
    })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (step === 'phone') sendCode()
    else if (step === 'code') checkCode(code)
    else if (step === 'name') createAccount()
    else signInStaff()
  }

  const errorBox = error && (
    <p className="notice error" role="alert">
      {error}
    </p>
  )

  return (
    <main className="page">
      <div className="auth-hero">
        <MokalaScene />
      </div>

      {step === 'phone' && (
        <>
          <h1 className="page-title">Sign in or join</h1>
          <p className="lead">Enter your phone number. We’ll SMS you a code. There’s no password to remember.</p>
          <form className="form" onSubmit={onSubmit} noValidate>
            {errorBox}
            <Field id="phone" label="Your phone number">
              <input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="071 234 5678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </Field>
            <button type="submit" className="btn btn-primary btn-block" disabled={busy || !phone.trim()}>
              {busy ? 'Sending…' : 'Send me a code'}
            </button>
          </form>
          <p className="notice" style={{ marginTop: 16 }}>
            <strong>One account for everything.</strong> Customers, sellers and couriers all sign in here. Sellers go
            straight to “My shop”.
          </p>
          <p style={{ textAlign: 'center', marginTop: 12 }}>
            <button type="button" className="link-btn" onClick={() => show('staff')}>
              Support staff sign-in
            </button>
          </p>
        </>
      )}

      {step === 'code' && (
        <>
          <h1 className="page-title">Enter the code</h1>
          <p className="lead">
            We sent a 6-digit code by SMS to{' '}
            <strong translate="no">{phone.trim()}</strong>.{' '}
            <button type="button" className="link-btn" onClick={() => show('phone')}>
              Change number
            </button>
          </p>
          {sent?.demoCode && (
            <p className="notice demo-box" style={{ marginTop: 0, marginBottom: 16 }}>
              <strong>Demo mode:</strong> no SMS is sent yet. Your code is{' '}
              <strong className="demo-code" translate="no">
                {sent.demoCode}
              </strong>
            </p>
          )}
          <form className="form" onSubmit={onSubmit} noValidate>
            {errorBox}
            <Field id="code" label="Code from the SMS">
              <input
                id="code"
                className="code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
                  setCode(digits)
                  // All 6 digits typed (or pasted, or filled in by the phone): continue by itself.
                  if (digits.length === 6 && !busy) checkCode(digits)
                }}
                autoFocus
              />
            </Field>
            <button type="submit" className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </form>
          <p style={{ textAlign: 'center', marginTop: 16 }}>
            {waitSeconds > 0 ? (
              <span className="product-meta">Didn’t get it? You can ask for a new code in {waitSeconds} s.</span>
            ) : (
              <button type="button" className="link-btn" onClick={sendCode} disabled={busy}>
                Didn’t get it? Send a new code
              </button>
            )}
          </p>
        </>
      )}

      {step === 'name' && (
        <>
          <h1 className="page-title">Welcome! What’s your name?</h1>
          <p className="lead">
            This number is new here, so we’re making your account. Sellers and couriers see this name on your orders.
          </p>
          <form className="form" onSubmit={onSubmit} noValidate>
            {errorBox}
            <Field id="name" label="Your name">
              <input
                id="name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
                autoFocus
              />
            </Field>
            <p className="fine-print" style={{ margin: 0 }}>
              We use your phone number and name to run your orders. <Link to="/privacy">How we use your information</Link>
            </p>
            <button type="submit" className="btn btn-primary btn-block" disabled={busy || name.trim().length < 2}>
              {busy ? 'Creating your account…' : 'Create my account'}
            </button>
          </form>
        </>
      )}

      {step === 'staff' && (
        <>
          <h1 className="page-title">Support staff sign-in</h1>
          <p className="lead">Staff use a passphrase, then a code from their authenticator app.</p>
          <form className="form" onSubmit={onSubmit} noValidate>
            {errorBox}
            <Field id="staff-phone" label="Phone number">
              <input
                id="staff-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </Field>
            <Field id="passphrase" label="Passphrase">
              <PassphraseInput id="passphrase" value={passphrase} onChange={setPassphrase} />
            </Field>
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p style={{ textAlign: 'center', marginTop: 16 }}>
            <button type="button" className="link-btn" onClick={() => show('phone')}>
              Back to sign-in with an SMS code
            </button>
          </p>
        </>
      )}
    </main>
  )
}

// Old links to /register still work: there is no separate sign-up any more.
export function RegisterPage() {
  const location = useLocation()
  return <Navigate to="/signin" replace state={location.state} />
}
