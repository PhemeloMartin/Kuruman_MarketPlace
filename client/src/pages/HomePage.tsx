import { useEffect, useState } from 'react'
import { useCart } from '../cart/CartContext'
import { MokalaScene } from '../components/Art'
import { SearchIcon } from '../components/Icons'
import { ProductCard } from '../components/ProductCard'
import { SiteHeader } from '../components/Layout'
import { SwitchSellerDialog } from '../components/SwitchSellerDialog'
import { api, ApiError } from '../lib/api'
import { STALE_AFTER_MS, filterSaved, loadCatalogue, saveCatalogue } from '../lib/catalogueCache'
import type { Category, Product } from '../lib/types'
import { useOnline } from '../lib/useOnline'

function savedTime(iso: string): string {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  return d.toLocaleString('en-ZA', sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function HomePage() {
  const cart = useCart()
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState<string>('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('') // search text, applied after the user pauses typing
  const [pending, setPending] = useState<Product | null>(null) // waiting on "switch seller?"
  const [savedAt, setSavedAt] = useState<string | null>(null) // set when showing the offline copy
  const [savedIsStale, setSavedIsStale] = useState(false)
  const online = useOnline()

  useEffect(() => {
    api<Category[]>('/categories')
      .then(setCategories)
      .catch(() => setCategories(loadCatalogue()?.categories ?? []))
  }, [online])

  // Wait 300 ms after the last keystroke before searching, so we don't call the API on every letter.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams()
    if (category) params.set('category', category)
    if (query) params.set('q', query)
    api<Product[]>(`/products?${params}`)
      .then((p) => {
        if (cancelled) return
        setProducts(p)
        setError(null)
        setSavedAt(null)
        // The full, unfiltered list is what we keep for offline browsing.
        if (!category && !query) {
          api<Category[]>('/categories').then((c) => saveCatalogue(c, p)).catch(() => {})
        }
      })
      .catch((err) => {
        if (cancelled) return
        // No connection: show the saved copy, clearly labelled with its age (spec 5.3).
        const saved = err instanceof ApiError && err.status === 0 ? loadCatalogue() : null
        if (saved) {
          setProducts(filterSaved(saved.products, category, query))
          setSavedAt(saved.savedAt)
          setSavedIsStale(Date.now() - new Date(saved.savedAt).getTime() > STALE_AFTER_MS)
          setError(null)
        } else {
          setError(
            err instanceof ApiError && err.status === 0
              ? 'You’re offline and no products are saved on this phone yet. Connect once to load the catalogue.'
              : err.message,
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [category, query, online])

  function handleAdd(product: Product) {
    if (cart.add(product) === 'other-seller') setPending(product)
  }

  const quantityOf = (id: number) => cart.lines.find((l) => l.productId === id)?.quantity ?? 0
  const filtering = Boolean(category || query)

  return (
    <>
      <SiteHeader />
      <main className="page">
        <label className="search">
          <SearchIcon />
          <span className="visually-hidden">Search products</span>
          <input
            type="search"
            placeholder="Search spinach, bread, crafts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            enterKeyHint="search"
          />
        </label>

        <div className="chips" role="group" aria-label="Categories">
          <button type="button" className="chip" aria-pressed={category === ''} onClick={() => setCategory('')}>
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.slug}
              type="button"
              className="chip"
              aria-pressed={category === c.slug}
              onClick={() => setCategory(c.slug)}
            >
              {c.name}
            </button>
          ))}
        </div>

        {!filtering && (
          <section className="banner" aria-label="Welcome">
            <div className="banner-text">
              <h2>Buy local. Support Kuruman.</h2>
              <p>Order from sellers in your area – collect or get it delivered.</p>
            </div>
            <div className="banner-art">
              <MokalaScene />
            </div>
          </section>
        )}

        {savedAt && (
          <p className="notice offline-note" role="status">
            <strong>Saved copy from {savedTime(savedAt)}.</strong>{' '}
            {savedIsStale
              ? 'It’s more than a day old, so prices and stock may have changed.'
              : 'Prices and stock may have changed.'}{' '}
            You can still fill your cart – it’s checked again when you’re back online.
          </p>
        )}

        <section aria-labelledby="products-heading" style={filtering ? { marginTop: 16 } : undefined}>
          <div className="section-head">
            <h2 id="products-heading">{filtering ? 'Results' : 'Near you'}</h2>
            {filtering && (
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setCategory('')
                  setSearch('')
                }}
              >
                Clear filters
              </button>
            )}
          </div>

          {error ? (
            <p className="notice error" role="alert">
              {error}
            </p>
          ) : products === null ? (
            <div className="product-grid" aria-busy="true" aria-label="Loading products">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton" />
              ))}
            </div>
          ) : products.length === 0 ? (
            <p className="notice">
              {filtering ? 'Nothing matches that yet. Try another word or category.' : 'No products listed yet.'}
            </p>
          ) : (
            <div className="product-grid">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} quantityInCart={quantityOf(p.id)} onAdd={handleAdd} />
              ))}
            </div>
          )}
        </section>
      </main>

      {pending && cart.business && (
        <SwitchSellerDialog
          currentSeller={cart.business.name}
          newSeller={pending.business.name}
          onKeep={() => setPending(null)}
          onReplace={() => {
            cart.replaceWith(pending)
            setPending(null)
          }}
        />
      )}
    </>
  )
}
