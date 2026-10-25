import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useAddToCart } from '../cart/useAddToCart'
import { BackIcon, CheckIcon, SearchIcon } from '../components/Icons'
import { KurumanPanorama, marketInfo, orderMarkets } from '../components/Markets'
import { ProductCard } from '../components/ProductCard'
import { SiteHeader } from '../components/Layout'
import { api, ApiError } from '../lib/api'
import { STALE_AFTER_MS, filterSaved, loadCatalogue, saveCatalogue } from '../lib/catalogueCache'
import type { Category, Product, Spotlight } from '../lib/types'
import { Stars } from '../components/Stars'
import { useOnline } from '../lib/useOnline'

// How many products the landing page shows before "See everything".
const LANDING_PRODUCTS = 8

function savedTime(iso: string): string {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  return d.toLocaleString('en-ZA', sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// For the landing page: take one product from each market in turn (in the markets' order), so the
// first row shows variety instead of four products starting with "B".
function mixMarkets(products: Product[], categories: Category[]): Product[] {
  const queues = categories.map((c) => products.filter((p) => p.category === c.slug))
  const mixed: Product[] = []
  for (let i = 0; mixed.length < products.length && queues.some((q) => i < q.length); i++) {
    for (const q of queues) if (i < q.length) mixed.push(q[i])
  }
  return mixed.length === products.length ? mixed : products // a market we don't know: keep the plain list
}

// Home has two views, chosen by the address bar:
//   /                          -> landing page: welcome, "Shop by market", new products, how to sell
//   /?market=livestock&q=goat  -> results for a market and/or search words ("market=all" = everything)
// Keeping the choice in the address means the phone's Back button works and a link to a market can
// be shared (for example on WhatsApp).
export function HomePage() {
  const { add, quantityOf, dialog } = useAddToCart()
  const [params, setParams] = useSearchParams()
  const market = params.get('market') ?? ''
  const query = (params.get('q') ?? '').trim()
  const category = market === 'all' ? '' : market
  const showResults = Boolean(market || query)

  const [categories, setCategories] = useState<Category[]>([])
  // The products loaded, and for which market + words. When you switch market, the old list
  // doesn't match any more, so we show the loading tiles until the new one arrives.
  const listKey = `${category}|${query}`
  const [loaded, setLoaded] = useState<{ key: string; products: Product[] } | null>(null)
  const products = loaded?.key === listKey ? loaded.products : null
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null) // set when showing the offline copy
  const [savedIsStale, setSavedIsStale] = useState(false)
  const [alsoSearched, setAlsoSearched] = useState<string[]>([]) // glossary words searched too (multilingual search)
  const online = useOnline()

  useEffect(() => {
    api<Category[]>('/categories')
      .then((c) => setCategories(orderMarkets(c)))
      .catch(() => setCategories(orderMarkets(loadCatalogue()?.categories ?? [])))
  }, [online])

  useEffect(() => {
    let cancelled = false
    const search = new URLSearchParams()
    if (category) search.set('category', category)
    if (query) search.set('q', query)
    // With search words: /search also says which other words (other languages, spellings) it tried.
    const request = query
      ? api<{ products: Product[]; alsoSearched: string[] }>(`/search?${search}`).then((r) => {
          if (!cancelled) setAlsoSearched(r.alsoSearched)
          return r.products
        })
      : api<Product[]>(`/products?${search}`)
    request
      .then((p) => {
        if (cancelled) return
        setLoaded({ key: `${category}|${query}`, products: p })
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
          setLoaded({ key: `${category}|${query}`, products: filterSaved(saved.products, category, query) })
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

  // Opens the results view. An empty market with no words means "everything".
  function showMarket(nextMarket: string, words: string) {
    const next = new URLSearchParams()
    next.set('market', nextMarket || 'all')
    if (words.trim()) next.set('q', words.trim())
    setParams(next)
    window.scrollTo({ top: 0 })
  }

  const productList = error ? (
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
      {showResults ? 'Nothing matches that yet. Try another word or market.' : 'No products listed yet.'}
    </p>
  ) : (
    <div className="product-grid">
      {(showResults ? products : mixMarkets(products, categories).slice(0, LANDING_PRODUCTS)).map((p) => (
        <ProductCard key={p.id} product={p} quantityInCart={quantityOf(p.id)} onAdd={add} />
      ))}
    </div>
  )

  const offlineNote = savedAt && (
    <p className="notice offline-note" role="status">
      <strong>Saved copy from {savedTime(savedAt)}.</strong>{' '}
      {savedIsStale
        ? 'It’s more than a day old, so prices and stock may have changed.'
        : 'Prices and stock may have changed.'}{' '}
      You can still fill your cart – it’s checked again when you’re back online.
    </p>
  )

  return (
    <>
      <SiteHeader />
      {showResults ? (
        <main className="page">
          <Link to="/" className="back-link">
            <BackIcon /> All markets
          </Link>
          <SearchBar
            key={`${market}|${query}`}
            categories={categories}
            market={category}
            words={query}
            onSearch={showMarket}
          />
          {offlineNote}
          <section aria-labelledby="results-heading" style={{ marginTop: 16 }}>
            <div className="section-head">
              <h1 id="results-heading" className="results-title">
                {category ? (categories.find((c) => c.slug === category)?.name ?? 'Results') : 'All products'}
                {query && <span className="results-words"> · “{query}”</span>}
              </h1>
              {products && !error && <span className="product-meta">{products.length} found</span>}
            </div>
            {query && alsoSearched.length > 0 && (
              <p className="fine-print" style={{ marginTop: -6 }}>
                Also searched: {alsoSearched.join(', ')}
              </p>
            )}
            {productList}
          </section>
        </main>
      ) : (
        <main className="page home">
          <Hero categories={categories} onSearch={showMarket} />

          <ul className="trust-strip" aria-label="Why shop here">
            <li>
              <CheckIcon /> Pay only after the seller accepts
            </li>
            <li>
              <CheckIcon /> Collect, or a local courier delivers
            </li>
            <li>
              <CheckIcon /> A handover code protects every order
            </li>
            <li>
              <CheckIcon /> English, Setswana, Afrikaans
            </li>
          </ul>

          <section aria-labelledby="markets-heading" className="home-section">
            <div className="section-head">
              <h2 id="markets-heading">Shop by market</h2>
              <button type="button" className="link-btn" onClick={() => showMarket('all', '')}>
                See everything
              </button>
            </div>
            <div className="market-grid">
              {categories.map((c) => (
                <MarketTile key={c.slug} category={c} onOpen={() => showMarket(c.slug, '')} />
              ))}
            </div>
          </section>

          <SpotlightCard />

          {offlineNote}

          <section aria-labelledby="products-heading" className="home-section">
            <div className="section-head">
              <h2 id="products-heading">On sale in Kuruman</h2>
              {products && products.length > LANDING_PRODUCTS && (
                <button type="button" className="link-btn" onClick={() => showMarket('all', '')}>
                  See all {products.length}
                </button>
              )}
            </div>
            {productList}
          </section>

          <SellBand />
          <HomeFooter />
        </main>
      )}

      {dialog}
    </>
  )
}

// Market dropdown + search words + Search button. Used in the welcome card and on the results view.
function SearchBar(props: {
  categories: Category[]
  market: string
  words: string
  onSearch: (market: string, words: string) => void
}) {
  const [market, setMarket] = useState(props.market)
  const [words, setWords] = useState(props.words)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    props.onSearch(market, words)
  }

  return (
    <form className="search-bar" role="search" onSubmit={onSubmit}>
      <label className="visually-hidden" htmlFor="market-select">
        Market
      </label>
      <select id="market-select" className="select" value={market} onChange={(e) => setMarket(e.target.value)}>
        <option value="">All markets</option>
        {props.categories.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.name}
          </option>
        ))}
      </select>
      <label className="search">
        <SearchIcon />
        <span className="visually-hidden">Search words</span>
        <input
          type="search"
          placeholder="Try spinach, bricks, goat, kota…"
          value={words}
          onChange={(e) => setWords(e.target.value)}
          enterKeyHint="search"
        />
      </label>
      <button type="submit" className="btn btn-primary">
        Search
      </button>
    </form>
  )
}

// The welcome card over the Kuruman scene, with two tabs: Shop (search) and Sell (how to start).
function Hero({ categories, onSearch }: { categories: Category[]; onSearch: (market: string, words: string) => void }) {
  const [tab, setTab] = useState<'shop' | 'sell'>('shop')
  return (
    <section className="hero" aria-label="Welcome">
      <div className="hero-art">
        <KurumanPanorama />
      </div>
      <div className="hero-card">
        <div className="tabs" role="tablist" aria-label="What would you like to do?">
          <button type="button" role="tab" id="tab-shop" aria-selected={tab === 'shop'} aria-controls="panel-shop" onClick={() => setTab('shop')}>
            I want to buy
          </button>
          <button type="button" role="tab" id="tab-sell" aria-selected={tab === 'sell'} aria-controls="panel-sell" onClick={() => setTab('sell')}>
            I want to sell
          </button>
        </div>
        {tab === 'shop' ? (
          <div role="tabpanel" id="panel-shop" aria-labelledby="tab-shop">
            <h1 className="hero-title">Everything Kuruman sells, in one place.</h1>
            <p className="hero-text">
              Fresh food, street food, bricks and sand, livestock, crafts and more, from local sellers. Collect it, or
              have it delivered.
            </p>
            <SearchBar categories={categories} market="" words="" onSearch={onSearch} />
          </div>
        ) : (
          <div role="tabpanel" id="panel-sell" aria-labelledby="tab-sell">
            <h1 className="hero-title">Sell to all of Kuruman.</h1>
            <SellSteps />
          </div>
        )}
      </div>
    </section>
  )
}

// One account does everything: you shop with it, and once support approves your shop, the same
// account also gets "My shop". So there is no "sign in as a seller" choice to get wrong.
function SellSteps() {
  const { user, loading } = useAuth()
  if (loading) return null
  const step = !user ? 1 : user.role === 'entrepreneur' ? 3 : 2
  return (
    <>
      <p className="hero-text">Free to list. Use the same account you shop with: no second account, no separate sign-in.</p>
      <ol className="steps">
        <li data-done={step > 1}>Join with your phone number: we SMS you a code</li>
        <li data-done={step > 2}>Apply to sell: your shop name, area and what you sell</li>
        <li data-done={step > 2}>Support checks it, and “My shop” appears in your menu</li>
      </ol>
      {!user ? (
        <>
          <Link to="/signin" state={{ from: '/profile#sell' }} className="btn btn-primary btn-block">
            Sign in or join with your phone
          </Link>
          <p className="hero-small">We SMS you a code. No password needed.</p>
        </>
      ) : user.role === 'entrepreneur' ? (
        <Link to="/seller" className="btn btn-primary btn-block">
          Go to my shop
        </Link>
      ) : user.role === 'consumer' ? (
        <Link to="/profile#sell" className="btn btn-primary btn-block">
          Apply to sell
        </Link>
      ) : (
        <p className="hero-small">This account is for {user.role === 'courier' ? 'deliveries' : 'support staff'}. To sell, use a customer account.</p>
      )}
    </>
  )
}

function MarketTile({ category, onOpen }: { category: Category; onOpen: () => void }) {
  const info = marketInfo(category.slug)
  const count = category.productCount
  return (
    <button type="button" className="market-tile" onClick={onOpen}>
      <span className="market-art">{info.photo ? <img src={info.photo} alt="" loading="lazy" /> : info.art}</span>
      <span className="market-label">
        <span className="market-name">{category.name}</span>
        <span className="market-blurb">{info.blurb}</span>
        {count !== undefined && (
          <span className="market-count">{count === 0 ? 'Coming soon' : `${count} ${count === 1 ? 'item' : 'items'}`}</span>
        )}
      </span>
    </button>
  )
}

// Entrepreneur of the Month: one local shop in the spotlight, with the numbers that earned it and
// the rule used, so everyone can see it's fair. Hidden until some shop qualifies.
function SpotlightCard() {
  const [spotlight, setSpotlight] = useState<Spotlight | null>(null)
  const [showRule, setShowRule] = useState(false)
  useEffect(() => {
    api<{ spotlight: Spotlight | null }>('/spotlight')
      .then((r) => setSpotlight(r.spotlight))
      .catch(() => {})
  }, [])
  if (!spotlight) return null
  const s = spotlight
  return (
    <section className="spotlight home-section" aria-labelledby="spotlight-heading">
      <div className="spotlight-art">{s.business.coverPhotoUrl ? <img src={s.business.coverPhotoUrl} alt="" /> : <KurumanPanorama />}</div>
      <div className="spotlight-body">
        <p className="spotlight-badge">🏆 Entrepreneur of the Month</p>
        <h2 id="spotlight-heading">{s.business.name}</h2>
        <p className="product-meta">{s.business.area}, Kuruman</p>
        {s.business.description && <p>{s.business.description}</p>}
        <ul className="spotlight-facts">
          <li>
            <strong>{s.completedOrders}</strong> orders completed
          </li>
          <li>
            <Stars value={s.averageRating} /> <strong>{s.averageRating.toFixed(1)}</strong> from {s.reviewCount} reviews
          </li>
          {s.acceptanceRate !== null && (
            <li>
              <strong>{Math.round(s.acceptanceRate * 100)}%</strong> of orders accepted
            </li>
          )}
        </ul>
        <div className="spotlight-actions">
          <Link to={`/shop/${s.business.id}`} className="btn btn-primary">
            Visit the shop
          </Link>
          <button type="button" className="link-btn" onClick={() => setShowRule((v) => !v)} aria-expanded={showRule}>
            How is this chosen?
          </button>
        </div>
        {showRule && <p className="fine-print">{s.rule}</p>}
      </div>
    </section>
  )
}

function SellBand() {
  return (
    <section className="sell-band" aria-labelledby="sell-heading">
      <div>
        <h2 id="sell-heading">Do you sell at the market, from home or from a caravan?</h2>
        <p>Put your shop in front of all of Kuruman. Customers order on the site, and you accept before anyone pays.</p>
      </div>
      <Link to="/profile#sell" className="btn btn-light">
        Start selling
      </Link>
    </section>
  )
}

function HomeFooter() {
  return (
    <footer className="home-footer">
      <div>
        <strong className="footer-brand" translate="no">
          KurumanMarketPlace
        </strong>
        <p>Local sellers, local couriers, local customers. The oasis of the Kalahari, online.</p>
      </div>
      <nav aria-label="More">
        <Link to="/?market=all">All products</Link>
        <Link to="/profile#sell">Sell with us</Link>
        <Link to="/orders">My orders</Link>
        <Link to="/privacy">Privacy</Link>
      </nav>
    </footer>
  )
}
