import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { MokalaScene } from '../components/Art'
import { ApiError } from '../lib/api'

// After signing in, go back to where the user was heading (e.g. the cart), otherwise Home.
function useReturnTo(): string {
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  return from && from.startsWith('/') ? from : '/'
}

function Field(props: {
  id: string
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="field" data-invalid={Boolean(props.error)}>
      <label htmlFor={props.id}>{props.label}</label>
      {props.hint && (
        <p className="hint" id={`${props.id}-hint`}>
          {props.hint}
        </p>
      )}
      <div className="input-wrap">{props.children}</div>
      {props.error && (
        <p className="field-error" id={`${props.id}-error`}>
          {props.error}
        </p>
      )}
    </div>
  )
}

function PassphraseInput({
  id,
  value,
  onChange,
  autoComplete,
  describedBy,
  invalid,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  autoComplete: string
  describedBy?: string
  invalid?: boolean
}) {
  const [show, setShow] = useState(false)
  return (
    <>
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required
        maxLength={128}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
      />
      <button type="button" className="link-btn" onClick={() => setShow((s) => !s)} aria-pressed={show}>
        {show ? 'Hide' : 'Show'}
      </button>
    </>
  )
}

export function SignInPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const returnTo = useReturnTo()
  const [phone, setPhone] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(phone, passphrase)
      navigate(returnTo, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <div className="auth-hero">
        <MokalaScene />
      </div>
      <h1 className="page-title">Sign in</h1>
      <form className="form" onSubmit={onSubmit} noValidate>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <Field id="phone" label="Phone number">
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
        <Field id="passphrase" label="Passphrase">
          <PassphraseInput id="passphrase" value={passphrase} onChange={setPassphrase} autoComplete="current-password" />
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p style={{ textAlign: 'center', marginTop: 20 }}>
        New here?{' '}
        <Link to="/register" state={{ from: returnTo }}>
          Create an account
        </Link>
      </p>
      <p className="notice demo-box">
        <strong>Demo:</strong> phone 071 000 0001 (customer) or 071 000 0002 (seller), passphrase{' '}
        <code translate="no">Kuruman Oasis 2026</code>
      </p>
    </main>
  )
}

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const returnTo = useReturnTo()
  const [displayName, setDisplayName] = useState('')
  const [phone, setPhone] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setFields({})
    try {
      await register({ displayName, phone, passphrase })
      navigate(returnTo, { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        setFields(err.fields)
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <h1 className="page-title">Create an account</h1>
      <form className="form" onSubmit={onSubmit} noValidate>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <Field id="name" label="Your name" error={fields.displayName}>
          <input
            id="name"
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={80}
            required
            aria-invalid={Boolean(fields.displayName) || undefined}
            aria-describedby={fields.displayName ? 'name-error' : undefined}
          />
        </Field>
        <Field id="phone" label="Phone number" error={fields.phone}>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="071 234 5678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            aria-invalid={Boolean(fields.phone) || undefined}
            aria-describedby={fields.phone ? 'phone-error' : undefined}
          />
        </Field>
        <Field
          id="new-passphrase"
          label="Passphrase"
          hint="At least 15 characters. A short sentence you'll remember works well, e.g. “my goats love the rain”."
          error={fields.passphrase}
        >
          <PassphraseInput
            id="new-passphrase"
            value={passphrase}
            onChange={setPassphrase}
            autoComplete="new-password"
            describedBy={`new-passphrase-hint${fields.passphrase ? ' new-passphrase-error' : ''}`}
            invalid={Boolean(fields.passphrase)}
          />
        </Field>
        <p className="fine-print" style={{ margin: '0 0 10px' }}>
          We use your phone number and name to run your orders. <Link to="/privacy">How we use your information</Link>
        </p>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p style={{ textAlign: 'center', marginTop: 20 }}>
        Already have an account?{' '}
        <Link to="/signin" state={{ from: returnTo }}>
          Sign in
        </Link>
      </p>
    </main>
  )
}
