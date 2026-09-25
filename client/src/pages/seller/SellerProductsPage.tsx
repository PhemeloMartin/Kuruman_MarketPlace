import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BackIcon } from '../../components/Icons'
import { api, ApiError } from '../../lib/api'
import { formatRand, parseRandToCents } from '../../lib/money'
import type { Category, SellerProduct } from '../../lib/types'
import { currentLanguage } from '../../lib/translate'

interface AiResult {
  available: boolean
  suggestionId?: number
  suggestion?: string | null
  score?: number | null
  abstained?: boolean
  reason?: string | null
  modelVersion?: string
}

function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="back-link">
      <BackIcon /> {label}
    </Link>
  )
}

export function SellerProductsPage() {
  const [products, setProducts] = useState<SellerProduct[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<SellerProduct[]>('/seller/products')
      .then(setProducts)
      .catch((err) => setError(err.message))
  }, [])

  return (
    <main className="page">
      <BackLink to="/seller" label="Dashboard" />
      <h1 className="page-title">Your products</h1>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {products?.length === 0 && <p className="notice">You haven’t listed anything yet.</p>}
      {products?.map((p) => {
        const low = p.isActive && p.availableQty <= p.lowStockThreshold
        return (
          <Link key={p.id} to={`/seller/products/${p.id}`} className="card product-row">
            <div style={{ minWidth: 0 }}>
              <div className="product-name">{p.name}</div>
              <div className="product-meta">
                {p.unitLabel} · <span translate="no">{formatRand(p.priceCents)}</span>
                {!p.isActive && ' · Hidden'}
              </div>
            </div>
            <div style={{ textAlign: 'right', flex: 'none' }}>
              <div className={low ? 'urgent' : undefined} style={{ fontWeight: 700 }}>
                {p.availableQty} available
              </div>
              {p.reservedQty > 0 && <div className="product-meta">{p.reservedQty} held for orders</div>}
              {low && <div className="product-meta urgent">Low stock</div>}
            </div>
          </Link>
        )
      })}
      <div className="sticky-action">
        <Link to="/seller/products/new" className="btn btn-dark btn-block">
          + Add a product
        </Link>
      </div>
    </main>
  )
}

// Add a new product (/seller/products/new) or edit one (/seller/products/:id).
export function SellerProductFormPage() {
  const { id } = useParams()
  const isNew = id === 'new'
  const navigate = useNavigate()
  const [categories, setCategories] = useState<Category[]>([])
  const [loaded, setLoaded] = useState(isNew)
  const [reserved, setReserved] = useState(0)
  const [form, setForm] = useState({
    name: '',
    category: '',
    unitLabel: '',
    price: '',
    stockQty: '',
    description: '',
    isActive: true,
  })
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [locale, setLocale] = useState(currentLanguage())
  const [ai, setAi] = useState<AiResult | null>(null)
  const [aiBusy, setAiBusy] = useState(false)

  // Ask the AI for a suggestion. It never fills in the category by itself -
  // the seller decides (spec FR-19, section 8.4).
  async function suggestCategory() {
    setAiBusy(true)
    setAi(null)
    try {
      setAi(
        await api<AiResult>('/seller/ai/category-suggestion', {
          method: 'POST',
          body: { title: form.name, description: form.description, locale },
        }),
      )
    } catch (err) {
      setFields((f) => ({ ...f, name: err instanceof ApiError ? err.message : 'Could not get a suggestion.' }))
    } finally {
      setAiBusy(false)
    }
  }
  const categoryName = (slug: string) => categories.find((c) => c.slug === slug)?.name ?? slug

  useEffect(() => {
    api<Category[]>('/categories').then(setCategories)
    if (!isNew) {
      api<SellerProduct[]>('/seller/products').then((list) => {
        const p = list.find((x) => String(x.id) === id)
        if (!p) {
          setError('Product not found.')
          return
        }
        setReserved(p.reservedQty)
        setForm({
          name: p.name,
          category: p.category,
          unitLabel: p.unitLabel,
          price: (p.priceCents / 100).toFixed(2),
          stockQty: String(p.stockQty),
          description: p.description ?? '',
          isActive: p.isActive,
        })
        setLoaded(true)
      })
    }
  }, [id, isNew])

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const priceCents = parseRandToCents(form.price)
    const stockQty = /^\d+$/.test(form.stockQty) ? Number(form.stockQty) : NaN
    const local: Record<string, string> = {}
    if (priceCents === null || priceCents <= 0) local.priceCents = 'Enter a price like 25 or 25.50.'
    if (!Number.isInteger(stockQty)) local.stockQty = 'Enter a whole number, e.g. 10.'
    if (Object.keys(local).length) {
      setFields(local)
      setError('Please check the highlighted fields.')
      return
    }

    setBusy(true)
    setError(null)
    setFields({})
    const body = {
      name: form.name,
      unitLabel: form.unitLabel,
      priceCents,
      stockQty,
      description: form.description,
      ...(isNew ? { category: form.category, aiSuggestionId: ai?.suggestionId } : { isActive: form.isActive }),
    }
    try {
      if (isNew) await api('/seller/products', { method: 'POST', body })
      else await api(`/seller/products/${id}`, { method: 'PATCH', body })
      navigate('/seller/products')
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        setFields(err.fields)
      } else setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) {
    return (
      <main className="page">
        <BackLink to="/seller/products" label="Your products" />
        {error ? <p className="notice error">{error}</p> : <div className="skeleton" style={{ minHeight: 300 }} />}
      </main>
    )
  }

  const err = (k: string) =>
    fields[k] ? (
      <p className="field-error" id={`${k}-error`}>
        {fields[k]}
      </p>
    ) : null

  return (
    <main className="page">
      <BackLink to="/seller/products" label="Your products" />
      <h1 className="page-title">{isNew ? 'Add a product' : 'Edit product'}</h1>
      <form className="form" onSubmit={onSubmit} noValidate>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <div className="field" data-invalid={Boolean(fields.name)}>
          <label htmlFor="name">Product name</label>
          <div className="input-wrap">
            <input id="name" value={form.name} onChange={set('name')} maxLength={100} placeholder="e.g. Brown bread" />
          </div>
          {err('name')}
        </div>

        {isNew && (
          <div className="field">
            <label htmlFor="description">Description (optional)</label>
            <div className="input-wrap">
              <textarea id="description" rows={3} value={form.description} onChange={set('description')} maxLength={1000} />
            </div>
          </div>
        )}

        {isNew && (
          <div className="field">
            <label htmlFor="locale">Language you wrote this in</label>
            <div className="input-wrap">
              <select id="locale" className="select" value={locale} onChange={(e) => setLocale(e.target.value as typeof locale)}>
                <option value="en">English</option>
                <option value="tn">Setswana</option>
                <option value="af">Afrikaans</option>
              </select>
            </div>
          </div>
        )}

        {isNew && (
          <div className="field" data-invalid={Boolean(fields.category)}>
            <label htmlFor="category">Category</label>
            <button
              type="button"
              className="btn btn-outline btn-block ai-btn"
              onClick={suggestCategory}
              disabled={aiBusy || form.name.trim().length < 2}
            >
              {aiBusy ? 'Thinking…' : '✦ Suggest a category (AI)'}
            </button>
            {ai && <AiSuggestionBox ai={ai} categoryName={categoryName} onUse={(slug) => setForm((f) => ({ ...f, category: slug }))} chosen={form.category} />}
            <div className="input-wrap">
              <select id="category" value={form.category} onChange={set('category')} className="select">
                <option value="">Choose…</option>
                {categories.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            {err('category')}
          </div>
        )}

        <div className="field" data-invalid={Boolean(fields.unitLabel)}>
          <label htmlFor="unit">Sold as</label>
          <p className="hint">One fixed unit, e.g. “1 loaf”, “1 bunch” or “1 x 5 kg bag”.</p>
          <div className="input-wrap">
            <input id="unit" value={form.unitLabel} onChange={set('unitLabel')} maxLength={40} />
          </div>
          {err('unitLabel')}
        </div>

        <div className="two-col">
          <div className="field" data-invalid={Boolean(fields.priceCents)}>
            <label htmlFor="price">Price (R)</label>
            <div className="input-wrap">
              <input id="price" inputMode="decimal" value={form.price} onChange={set('price')} placeholder="25.00" />
            </div>
            {err('priceCents')}
          </div>
          <div className="field" data-invalid={Boolean(fields.stockQty)}>
            <label htmlFor="stock">In stock</label>
            <div className="input-wrap">
              <input id="stock" inputMode="numeric" value={form.stockQty} onChange={set('stockQty')} placeholder="10" />
            </div>
            {err('stockQty')}
          </div>
        </div>
        {reserved > 0 && <p className="fine-print" style={{ marginTop: -8 }}>{reserved} are held for open orders, so stock can’t go below {reserved}.</p>}

        {!isNew && (
          <div className="field">
            <label htmlFor="description">Description (optional)</label>
            <div className="input-wrap">
              <textarea id="description" rows={3} value={form.description} onChange={set('description')} maxLength={1000} />
            </div>
          </div>
        )}

        {!isNew && (
          <label className="choice">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Show this product to customers
          </label>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : isNew ? 'Add product' : 'Save changes'}
        </button>
      </form>
    </main>
  )
}

// Shows the AI's suggestion, clearly labelled, with the seller in control.
function AiSuggestionBox({
  ai,
  categoryName,
  onUse,
  chosen,
}: {
  ai: AiResult
  categoryName: (slug: string) => string
  onUse: (slug: string) => void
  chosen: string
}) {
  if (!ai.available) {
    return (
      <p className="ai-box" role="status">
        Category suggestions aren’t available right now. Please choose the category yourself.
      </p>
    )
  }
  if (ai.abstained || !ai.suggestion) {
    return (
      <p className="ai-box" role="status">
        <span className="ai-label">AI suggestion</span>
        {ai.reason === 'unsupported_language'
          ? 'The AI can’t read this language yet. Please choose the category yourself.'
          : 'The AI isn’t sure about this one. Please choose the category yourself.'}
      </p>
    )
  }
  const used = chosen === ai.suggestion
  return (
    <div className="ai-box" role="status">
      <span className="ai-label">AI suggestion</span>
      <p style={{ margin: '4px 0 8px' }}>
        <strong>{categoryName(ai.suggestion)}</strong>{' '}
        <span className="product-meta">(confidence {Math.round((ai.score ?? 0) * 100)}%)</span>
        <br />
        <span className="fine-print">Suggested by a trained model ({ai.modelVersion}). It can be wrong – please check.</span>
      </p>
      <button type="button" className="btn btn-primary btn-block" onClick={() => onUse(ai.suggestion!)} disabled={used}>
        {used ? '✓ Using this category' : 'Use this category'}
      </button>
    </div>
  )
}
