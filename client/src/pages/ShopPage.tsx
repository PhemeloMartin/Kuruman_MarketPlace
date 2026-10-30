import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAddToCart } from '../cart/useAddToCart'
import { BackIcon } from '../components/Icons'
import { KurumanPanorama } from '../components/Markets'
import { ProductCard } from '../components/ProductCard'
import { CallButton } from '../components/CallButton'
import { RatingLine, Stars } from '../components/Stars'
import { api } from '../lib/api'
import { chatLink, pageUrl, shareLink } from '../lib/whatsapp'
import { NEGATIVE_THEMES, THEME_LABEL, stallDaysText } from '../lib/types'
import type { Shop } from '../lib/types'

// A shop's own page: cover photo, who they are, and everything they sell.
export function ShopPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { add, quantityOf, dialog } = useAddToCart()
  const [shop, setShop] = useState<Shop | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<Shop>(`/shops/${id}`)
      .then(setShop)
      .catch((err) => setError(err.message))
  }, [id])

  if (error) {
    return (
      <main className="page">
        <p className="notice error" role="alert">
          {error}
        </p>
      </main>
    )
  }
  if (!shop) {
    return (
      <main className="page">
        <div className="skeleton" style={{ minHeight: 360 }} aria-busy="true" />
      </main>
    )
  }

  const since = new Date(shop.sellingSince).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })

  return (
    <main className="page shop-page">
      <button type="button" className="back-link link-plain" onClick={() => navigate(-1)}>
        <BackIcon /> Back
      </button>
      <div className="shop-cover">{shop.coverPhotoUrl ? <img src={shop.coverPhotoUrl} alt="" /> : <KurumanPanorama />}</div>
      <h1 className="page-title" style={{ marginBottom: 4 }}>
        {shop.name}
      </h1>
      {shop.isSpotlight && <p className="spotlight-badge">🏆 Entrepreneur of the Month</p>}
      <p className="product-meta" style={{ fontSize: '0.95rem', marginTop: 0 }}>
        {shop.area}, Kuruman · selling here since {since}
      </p>
      <a href="#reviews" className="rating-link">
        <RatingLine rating={shop.rating} />
      </a>
      {shop.stall && (
        <div className="stall-card">
          <p className="stall-status">
            <span className={`status-dot${shop.stall.hereNow ? '' : ' off'}`} aria-hidden="true" />
            {shop.stall.hereNow ? 'At the stall now' : 'Not at the stall right now'}
          </p>
          <p>
            📍 <strong>{shop.stall.location}</strong>
            <br />
            🗓 {stallDaysText(shop.stall.days)}, {shop.stall.opens}–{shop.stall.closes}
          </p>
          <p className="fine-print">
            Reserve online, then collect and pay at the stall. The stall holder gets your order by SMS.
          </p>
          <a
            className="link-btn"
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${shop.stall.location}, Kuruman`)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Show on a map
          </a>
        </div>
      )}
      {shop.description && <p style={{ whiteSpace: 'pre-line' }}>{shop.description}</p>}
      <div className="share-row">
        <a
          className="btn btn-whatsapp"
          href={shareLink(`${shop.name} is on KurumanMarketPlace. Order from them here:`, pageUrl(`/shop/${shop.id}`))}
          target="_blank"
          rel="noopener noreferrer"
        >
          Share on WhatsApp
        </a>
        {shop.whatsapp && (
          <a
            className="btn btn-outline"
            href={chatLink(shop.whatsapp, `Hi ${shop.name}! I found you on KurumanMarketPlace:`, pageUrl(`/shop/${shop.id}`))}
            target="_blank"
            rel="noopener noreferrer"
          >
            Chat on WhatsApp
          </a>
        )}
      </div>

      {shop.callsEnabled && <CallButton target={{ shopId: shop.id }} label={`Call ${shop.name} free`} />}

      <section aria-labelledby="shop-products" style={{ marginTop: 20 }}>
        <div className="section-head">
          <h2 id="shop-products">On sale</h2>
          <span className="product-meta">
            {shop.products.length} {shop.products.length === 1 ? 'product' : 'products'}
          </span>
        </div>
        {shop.products.length === 0 ? (
          <p className="notice">Nothing on sale right now. Check back soon.</p>
        ) : (
          <div className="product-grid">
            {shop.products.map((p) => (
              <ProductCard key={p.id} product={p} quantityInCart={quantityOf(p.id)} onAdd={add} hideSeller />
            ))}
          </div>
        )}
      </section>

      <section id="reviews" aria-labelledby="reviews-heading" style={{ marginTop: 24 }}>
        <div className="section-head">
          <h2 id="reviews-heading">What customers say</h2>
        </div>
        <p className="fine-print" style={{ marginTop: -6 }}>
          Only customers who bought and received an order here can review it.
        </p>
        {shop.customerThemes.length > 0 && (
          <p className="theme-chips">
            <span className="ai-label">AI summary</span> Customers mention:{' '}
            {shop.customerThemes.map((t) => (
              <span key={t.theme} className={`theme-chip${NEGATIVE_THEMES.includes(t.theme) ? ' negative' : ''}`}>
                {THEME_LABEL[t.theme] ?? t.theme} ({t.count})
              </span>
            ))}
          </p>
        )}
        {shop.reviews.length === 0 ? (
          <p className="notice">No reviews yet.</p>
        ) : (
          <ul className="review-list">
            {shop.reviews.map((r) => (
              <li key={r.id} className="card">
                <div className="review-head">
                  <Stars value={r.rating} />
                  <span className="product-meta">
                    {r.firstName} · {new Date(r.createdAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                {r.comment && <p className="review-text">{r.comment}</p>}
                {r.sellerReply && (
                  <p className="seller-reply">
                    <strong>{shop.name} replied:</strong> {r.sellerReply}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {dialog}
    </main>
  )
}
