import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { SearchIcon } from '../components/Icons'
import { api, ApiError } from '../lib/api'

interface Listing {
  id: number
  name: string
  category: string
  categoryName: string
  description: string | null
  area: string
  phone: string
  hasWhatsapp: boolean
  hours: string | null
}

const localPhone = (e164: string) => '0' + e164.slice(3).replace(/(\d{2})(\d{3})(\d{4})/, '$1 $2 $3')

// Kuruman Business Directory: local services you phone directly - plumbers, hairdressers, mechanics...
// Free to list; support checks every listing before it appears.
export function DirectoryPage() {
  const [categories, setCategories] = useState<Record<string, string>>({})
  const [listings, setListings] = useState<Listing[] | null>(null)
  const [category, setCategory] = useState('')
  const [words, setWords] = useState('')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const p = new URLSearchParams()
    if (category) p.set('category', category)
    if (query) p.set('q', query)
    api<{ categories: Record<string, string>; listings: Listing[] }>(`/directory?${p}`)
      .then((r) => {
        setCategories(r.categories)
        setListings(r.listings)
      })
      .catch(() => setListings([]))
  }, [category, query])

  return (
    <main className="page">
      <h1 className="page-title" style={{ marginBottom: 4 }}>
        Kuruman Business Directory
      </h1>
      <p className="lead">Local services you can call: plumbers, hairdressers, mechanics, tailors and more.</p>

      <form
        className="search-bar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          setQuery(words.trim())
        }}
      >
        <label className="visually-hidden" htmlFor="dir-category">
          Kind of service
        </label>
        <select id="dir-category" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All services</option>
          {Object.entries(categories).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <label className="search">
          <SearchIcon />
          <span className="visually-hidden">Search words</span>
          <input type="search" placeholder="Try geyser, braids, brakes…" value={words} onChange={(e) => setWords(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </form>

      <section style={{ marginTop: 16 }} aria-label="Listings">
        {listings?.length === 0 && <p className="notice">Nothing found yet. Try another word or kind of service.</p>}
        {listings?.map((l) => (
          <article key={l.id} className="card directory-card">
            <div className="order-card-head">
              <strong>{l.name}</strong>
              <span className="tag">{l.categoryName}</span>
            </div>
            {l.description && <p className="review-text">{l.description}</p>}
            <p className="product-meta" style={{ margin: '6px 0 0' }}>
              📍 {l.area}
              {l.hours && <> · 🕒 {l.hours}</>} · <span translate="no">{localPhone(l.phone)}</span>
            </p>
            <div className="share-row">
              <a className="btn btn-primary" href={`tel:${l.phone}`}>
                📞 Call
              </a>
              {l.hasWhatsapp && (
                <a
                  className="btn btn-whatsapp"
                  href={`https://wa.me/${l.phone.replace(/\D/g, '')}?text=${encodeURIComponent('Hi! I found you in the Kuruman Business Directory on KurumanMarketPlace.')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  WhatsApp
                </a>
              )}
            </div>
          </article>
        ))}
      </section>

      <section className="sell-band" style={{ marginTop: 24 }}>
        <div>
          <h2>Offer a service in Kuruman?</h2>
          <p>List your business here for free. We check every listing before it appears.</p>
        </div>
        {!adding && (
          <button type="button" className="btn btn-light" onClick={() => setAdding(true)}>
            Add a business
          </button>
        )}
      </section>
      {adding && <AddListing categories={categories} onDone={() => setAdding(false)} />}
      <p className="fine-print" style={{ marginTop: 16 }}>
        Selling products? <Link to="/profile#sell">Open a shop</Link> on KurumanMarketPlace instead, so customers can order
        and pay safely.
      </p>
    </main>
  )
}

function AddListing({ categories, onDone }: { categories: Record<string, string>; onDone: () => void }) {
  const { user } = useAuth()
  const [areas, setAreas] = useState<string[]>([])
  const [form, setForm] = useState({ name: '', category: '', description: '', area: '', phone: '', hours: '', hasWhatsapp: false, consent: false })
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ serviceAreas: string[] }>('/config').then((c) => setAreas(c.serviceAreas))
  }, [])

  if (!user) {
    return (
      <p className="notice" style={{ marginTop: 12 }}>
        <Link to="/signin" state={{ from: '/directory' }}>
          Sign in
        </Link>{' '}
        first, so we can contact you about the listing.
      </p>
    )
  }
  if (sent) {
    return (
      <p className="notice success" style={{ marginTop: 12 }}>
        Thank you! Support will check the listing, usually within a day. You’ll see it here once it’s approved.
      </p>
    )
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const err = (k: string) => fields[k] && <p className="field-error">{fields[k]}</p>

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setFields({})
    try {
      await api('/directory', { method: 'POST', body: form })
      setSent(true)
    } catch (ex) {
      if (ex instanceof ApiError) {
        setError(ex.message)
        setFields(ex.fields)
      } else setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form card" style={{ marginTop: 12 }} onSubmit={submit} noValidate>
      {error && <p className="notice error">{error}</p>}
      <div className="field">
        <label htmlFor="d-name">Business name</label>
        <div className="input-wrap">
          <input id="d-name" maxLength={100} value={form.name} onChange={set('name')} />
        </div>
        {err('name')}
      </div>
      <div className="field">
        <label htmlFor="d-cat">Kind of service</label>
        <div className="input-wrap">
          <select id="d-cat" className="select" value={form.category} onChange={set('category')}>
            <option value="">Choose…</option>
            {Object.entries(categories).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        {err('category')}
      </div>
      <div className="field">
        <label htmlFor="d-desc">What do you do? (optional)</label>
        <div className="input-wrap">
          <textarea id="d-desc" rows={2} maxLength={400} value={form.description} onChange={set('description')} />
        </div>
      </div>
      <div className="two-col">
        <div className="field">
          <label htmlFor="d-area">Area</label>
          <div className="input-wrap">
            <select id="d-area" className="select" value={form.area} onChange={set('area')}>
              <option value="">Choose…</option>
              {areas.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </div>
          {err('area')}
        </div>
        <div className="field">
          <label htmlFor="d-phone">Phone number</label>
          <div className="input-wrap">
            <input id="d-phone" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} />
          </div>
          {err('phone')}
        </div>
      </div>
      <div className="field">
        <label htmlFor="d-hours">Hours (optional)</label>
        <div className="input-wrap">
          <input id="d-hours" maxLength={80} placeholder="Mon-Sat 08:00-17:00" value={form.hours} onChange={set('hours')} />
        </div>
      </div>
      <label className="choice">
        <input type="checkbox" checked={form.hasWhatsapp} onChange={(e) => setForm((f) => ({ ...f, hasWhatsapp: e.target.checked }))} />
        This number has WhatsApp
      </label>
      <label className="choice">
        <input type="checkbox" checked={form.consent} onChange={(e) => setForm((f) => ({ ...f, consent: e.target.checked }))} />
        I own this business, or the owner agreed that this phone number may be shown publicly
      </label>
      {err('consent')}
      <div className="btn-row">
        <button type="button" className="btn btn-outline" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Sending…' : 'Send for approval'}
        </button>
      </div>
    </form>
  )
}
