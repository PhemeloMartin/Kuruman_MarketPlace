import { useEffect, useState } from 'react'
import { useCart } from '../cart/CartContext'
import { MokalaScene } from '../components/Art'
import { SearchIcon } from '../components/Icons'
import { ProductCard } from '../components/ProductCard'
import { SiteHeader } from '../components/Layout'
import { SwitchSellerDialog } from '../components/SwitchSellerDialog'
import { api } from '../lib/api'
import type { Category, Product } from '../lib/types'

export function HomePage() {
  const cart = useCart()
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState<string>('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('') // search text, applied after the user pauses typing
  const [pending, setPending] = useState<Product | null>(null) // waiting on "switch seller?"

  useEffect(() => {
    api<Category[]>('/categories').then(setCategories).catch(() => setCategories([]))
  }, [])

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
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [category, query])

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
