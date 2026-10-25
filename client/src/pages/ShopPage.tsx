import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAddToCart } from '../cart/useAddToCart'
import { BackIcon } from '../components/Icons'
import { KurumanPanorama } from '../components/Markets'
import { ProductCard } from '../components/ProductCard'
import { api } from '../lib/api'
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
      <p className="product-meta" style={{ fontSize: '0.95rem', marginTop: 0 }}>
        {shop.area}, Kuruman · selling here since {since}
      </p>
      {shop.description && <p style={{ whiteSpace: 'pre-line' }}>{shop.description}</p>}

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
      {dialog}
    </main>
  )
}
