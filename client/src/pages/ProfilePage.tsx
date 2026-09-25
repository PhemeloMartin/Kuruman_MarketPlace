import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { MokalaScene } from '../components/Art'
import { LANGUAGES, currentLanguage } from '../lib/translate'

const ROLE_LABEL = {
  consumer: 'Customer',
  entrepreneur: 'Seller',
  courier: 'Courier',
  support: 'Support',
}

// Shows 071 234 5678 instead of +27712345678.
function localPhone(e164: string): string {
  const n = '0' + e164.slice(3)
  return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`
}

export function ProfilePage() {
  const { user, loading, logout } = useAuth()
  const navigate = useNavigate()

  if (loading) return null

  if (!user) {
    return (
      <main className="page">
        <div className="auth-hero">
          <MokalaScene />
        </div>
        <h1 className="page-title">Welcome</h1>
        <p style={{ color: 'var(--muted)', marginTop: -8 }}>
          Browse without an account. Sign in when you’re ready to order.
        </p>
        <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
          <Link to="/signin" className="btn btn-primary">
            Sign in
          </Link>
          <Link to="/register" className="btn btn-outline">
            Create an account
          </Link>
        </div>
      </main>
    )
  }

  const language = LANGUAGES.find((l) => l.code === currentLanguage())?.name

  return (
    <main className="page">
      <h1 className="page-title">Profile</h1>
      <section className="card">
        <h2 style={{ fontSize: '1.2rem' }}>{user.displayName}</h2>
        <p className="product-meta" style={{ margin: '4px 0 10px' }} translate="no">
          {localPhone(user.phone)}
        </p>
        <span className="role-pill">{ROLE_LABEL[user.role]}</span>
      </section>
      <section className="card">
        <strong>Language</strong>
        <p className="product-meta" style={{ margin: '4px 0 0' }}>
          {language}. Change it with the button at the top of the Home screen. Setswana and Afrikaans are machine
          translated for now and are being checked by fluent speakers.
        </p>
      </section>
      {user.role === 'courier' && (
        <Link to="/courier" className="btn btn-primary btn-block" style={{ marginBottom: 10 }}>
          Go to deliveries
        </Link>
      )}
      {user.role === 'entrepreneur' && (
        <Link to="/seller" className="btn btn-primary btn-block" style={{ marginBottom: 10 }}>
          Go to my shop
        </Link>
      )}
      <button
        type="button"
        className="btn btn-outline btn-block"
        onClick={async () => {
          await logout()
          navigate('/', { replace: true })
        }}
      >
        Sign out
      </button>
    </main>
  )
}
