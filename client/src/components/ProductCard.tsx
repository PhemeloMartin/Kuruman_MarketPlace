import { Link } from 'react-router-dom'
import { examplePhoto } from '../lib/examplePhotos'
import { formatRand } from '../lib/money'
import type { Product } from '../lib/types'
import { CheckIcon, PlusIcon } from './Icons'

// The seller's own photo; until they add one, a photo of that kind of product (lib/examplePhotos.ts);
// only when nothing fits, a tile with the first letter.
export function ProductPhoto({
  product,
  className = 'product-photo',
}: {
  product: Pick<Product, 'id' | 'name' | 'imageUrl'> & { category?: string }
  className?: string
}) {
  if (product.imageUrl) {
    return (
      <div className={className}>
        <img src={product.imageUrl} alt="" loading="lazy" />
      </div>
    )
  }
  const example = examplePhoto(product.name, product.category)
  if (example) {
    return (
      <div className={className}>
        <img src={example} alt="" loading="lazy" />
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
        {product.business.kind === 'market_stall' && <span className="tag stall-tag">Market stall</span>}
        {product.collectionOnly && (
          <span className="tag">{product.business.ownDeliveryFeeCents != null ? 'Seller delivers' : 'Collect only'}</span>
        )}
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
