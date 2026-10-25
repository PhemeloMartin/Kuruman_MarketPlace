import { useState } from 'react'
import { SwitchSellerDialog } from '../components/SwitchSellerDialog'
import type { Product } from '../lib/types'
import { useCart } from './CartContext'

// "Add to cart" for any page that shows products. Business rule 1 (one seller per order): if the
// cart holds another seller's products, the shopper is asked first - `dialog` shows that question,
// so the page just renders it.
export function useAddToCart() {
  const cart = useCart()
  const [pending, setPending] = useState<Product | null>(null)

  function add(product: Product) {
    if (cart.add(product) === 'other-seller') setPending(product)
  }

  const quantityOf = (id: number) => cart.lines.find((l) => l.productId === id)?.quantity ?? 0

  const dialog =
    pending && cart.business ? (
      <SwitchSellerDialog
        currentSeller={cart.business.name}
        newSeller={pending.business.name}
        onKeep={() => setPending(null)}
        onReplace={() => {
          cart.replaceWith(pending)
          setPending(null)
        }}
      />
    ) : null

  return { add, quantityOf, dialog }
}
