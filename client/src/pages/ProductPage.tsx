import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAddToCart } from '../cart/useAddToCart'
import { BackIcon, CheckIcon, PlusIcon } from '../components/Icons'
import { ProductPhoto } from '../components/ProductCard'
import { api } from '../lib/api'
import { formatRand } from '../lib/money'
import type { Product } from '../lib/types'

// One product: its photos, price, who sells it, and "Add to cart".
export function ProductPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { add, quantityOf, dialog } = useAddToCart()
  const [product, setProduct] = useState<Product | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState(0) // which photo is shown large

  useEffect(() => {
    api<Product>(`/products/${id}`)
      .then((p) => {
        setProduct(p)
        setShown(0)
      })
      .catch((err) => setError(err.message))
  }, [id])

  const back = (
    <button type="button" className="back-link link-plain" onClick={() => navigate(-1)}>
      <BackIcon /> Back
    </button>
  )

  if (error) {
    return (
      <main className="page">
        {back}
        <p className="notice error" role="alert">
          {error}
        </p>
      </main>
    )
  }
  if (!product) {
    return (
      <main className="page">
        <div className="skeleton" style={{ minHeight: 360 }} aria-busy="true" />
      </main>
    )
  }

  const photos = product.photos ?? []
  const inCart = quantityOf(product.id)
  const soldOut = product.availableQty <= 0
  const atLimit = inCart >= product.availableQty

  return (
    <main className="page product-page">
      {back}
      <div className="gallery">
        {photos.length > 0 ? (
          <img src={photos[shown]} alt={product.name} className="gallery-main" />
        ) : (
          <ProductPhoto product={product} className="gallery-main product-photo" />
        )}
        {photos.length > 1 && (
          <div className="gallery-thumbs" role="group" aria-label="More photos">
            {photos.map((url, i) => (
              <button key={url} type="button" aria-pressed={i === shown} aria-label={`Photo ${i + 1}`} onClick={() => setShown(i)}>
                <img src={url} alt="" />
              </button>
            ))}
          </div>
        )}
      </div>

      <h1 className="page-title" style={{ marginBottom: 4 }}>
        {product.name}
      </h1>
      <p className="product-meta" style={{ fontSize: '0.95rem' }}>
        {product.unitLabel} · {product.categoryName}
      </p>
      <p className="big-price" translate="no">
        {formatRand(product.priceCents)}
      </p>
      <p className={soldOut || product.availableQty <= 5 ? 'urgent' : 'product-meta'}>
        {soldOut ? 'Sold out for now' : product.availableQty <= 5 ? `Only ${product.availableQty} left` : 'In stock'}
      </p>

      <button type="button" className="btn btn-primary btn-block" disabled={soldOut || atLimit} onClick={() => add(product)}>
        {inCart > 0 ? <CheckIcon /> : <PlusIcon />}
        {inCart > 0 ? `In your cart (${inCart}) · add another` : 'Add to cart'}
      </button>
      {inCart > 0 && (
        <Link to="/cart" className="btn btn-outline btn-block" style={{ marginTop: 10 }}>
          Go to cart
        </Link>
      )}

      {product.description && (
        <section style={{ marginTop: 20 }}>
          <h2 className="small-heading">About this product</h2>
          <p style={{ whiteSpace: 'pre-line' }}>{product.description}</p>
        </section>
      )}

      <Link to={`/shop/${product.business.id}`} className="card seller-link">
        <span className="product-meta">Sold by</span>
        <strong>{product.business.name}</strong>
        <span className="product-meta">{product.business.area}, Kuruman · See everything they sell</span>
      </Link>
      {dialog}
    </main>
  )
}
