import { Link } from 'react-router-dom'
import { formatRand } from '../lib/money'
import type { Product } from '../lib/types'
import { CheckIcon, PlusIcon } from './Icons'

// Products without a photo get a coloured tile with their first letter - never a stock photo,
// because a decorative picture could mislead buyers about what they're getting.
export function ProductPhoto({ product, className = 'product-photo' }: { product: Pick<Product, 'id' | 'name' | 'imageUrl'>; className?: string }) {
  if (product.imageUrl) {
    return (
      <div className={className}>
        <img src={product.imageUrl} alt="" loading="lazy" />
      </div>
    )
  }
  return (
    <div className={`${className} tone-${product.id % 4}`} aria-hidden="true">
      {product.name.charAt(0)}
    </div>
  )
}

interface Props {
  product: Product
  quantityInCart: number
  onAdd: (product: Product) => void
  hideSeller?: boolean // on the shop's own page, every card is from that shop
}

export function ProductCard({ product, quantityInCart, onAdd, hideSeller }: Props) {
  const soldOut = product.availableQty <= 0
  const atLimit = quantityInCart >= product.availableQty

  return (
    <article className="product-card">
      {/* The photo and name open the product page; the seller's name opens their shop. */}
      <Link to={`/product/${product.id}`} className="product-link" tabIndex={-1} aria-hidden="true">
        <ProductPhoto product={product} />
      </Link>
      <div className="product-body">
        {product.collectionOnly && <span className="tag">Collect only</span>}
        <h3 className="product-name">
          <Link to={`/product/${product.id}`} className="product-link">
            {product.name}
          </Link>
        </h3>
        <span className="product-meta">
          {product.unitLabel}
          {!hideSeller && (
            <>
              {' · '}
              <Link to={`/shop/${product.business.id}`}>{product.business.name}</Link>
            </>
          )}
        </span>
        <div className="product-foot">
          {soldOut ? (
            <span className="product-meta">Sold out</span>
          ) : (
            <span className="price" translate="no">
              {formatRand(product.priceCents)}
            </span>
          )}
          <button
            type="button"
            className={`round-btn${quantityInCart > 0 ? ' in-cart' : ''}`}
            onClick={() => onAdd(product)}
            disabled={soldOut || atLimit}
            aria-label={
              quantityInCart > 0
                ? `Add another ${product.name} (${quantityInCart} in cart)`
                : `Add ${product.name} to cart`
            }
          >
            {quantityInCart > 0 && atLimit ? <CheckIcon /> : <PlusIcon />}
          </button>
        </div>
      </div>
    </article>
  )
}
