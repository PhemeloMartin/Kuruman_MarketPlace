import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Product } from '../lib/types'

// A cart line keeps a copy of what the shopper saw. It's only a *draft*:
// the server re-checks prices and stock when the order is actually sent (business rule 5).
export interface CartLine {
  productId: number
  name: string
  unitLabel: string
  priceCents: number
  quantity: number
}

interface CartDraft {
  business: { id: number; name: string } | null
  lines: CartLine[]
  updatedAt: string | null
}

export type AddResult = 'added' | 'other-seller'

interface CartState extends CartDraft {
  itemCount: number
  subtotalCents: number
  add: (product: Product) => AddResult
  replaceWith: (product: Product) => void
  setQuantity: (productId: number, quantity: number) => void
  refresh: (latest: Map<number, Product | null>) => string[]
  clear: () => void
}

const STORAGE_KEY = 'kmp_cart_draft'
const MAX_QTY = 99 // spec 7.3: 1-99 units per line
const EMPTY: CartDraft = { business: null, lines: [], updatedAt: null }

function loadDraft(): CartDraft {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY
  } catch {
    return EMPTY
  }
}

function lineFrom(product: Product): CartLine {
  return {
    productId: product.id,
    name: product.name,
    unitLabel: product.unitLabel,
    priceCents: product.priceCents,
    quantity: 1,
  }
}

const CartContext = createContext<CartState | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<CartDraft>(loadDraft)

  // Save the draft on this phone so it survives a refresh or losing signal.
  // It holds no personal details - just product ids, names, prices and quantities.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
    } catch {
      // Storage full or blocked (private window) - the cart still works for this visit.
    }
  }, [draft])

  const touch = (d: Omit<CartDraft, 'updatedAt'>): CartDraft => ({ ...d, updatedAt: new Date().toISOString() })

  // One seller per order (business rule 1). Adding from a different seller never
  // silently empties the cart - we report 'other-seller' and let the shopper decide.
  const add = useCallback(
    (product: Product): AddResult => {
      if (draft.business && draft.business.id !== product.business.id && draft.lines.length > 0) {
        return 'other-seller'
      }
      setDraft((d) => {
        const existing = d.lines.find((l) => l.productId === product.id)
        const lines = existing
          ? d.lines.map((l) =>
              l.productId === product.id ? { ...l, quantity: Math.min(l.quantity + 1, MAX_QTY) } : l,
            )
          : [...d.lines, lineFrom(product)]
        return touch({ business: { id: product.business.id, name: product.business.name }, lines })
      })
      return 'added'
    },
    [draft.business, draft.lines.length],
  )

  const replaceWith = useCallback((product: Product) => {
    setDraft(touch({ business: { id: product.business.id, name: product.business.name }, lines: [lineFrom(product)] }))
  }, [])

  const setQuantity = useCallback((productId: number, quantity: number) => {
    setDraft((d) => {
      const lines =
        quantity <= 0
          ? d.lines.filter((l) => l.productId !== productId)
          : d.lines.map((l) => (l.productId === productId ? { ...l, quantity: Math.min(quantity, MAX_QTY) } : l))
      return touch({ business: lines.length ? d.business : null, lines })
    })
  }, [])

  // Brings the draft up to date with what the server says now (spec FR-08: a draft is
  // re-checked before it is sent). Returns plain-language notes about anything that changed.
  const refresh = useCallback(
    (latest: Map<number, Product | null>): string[] => {
      const notes: string[] = []
      const lines: CartLine[] = []
      for (const line of draft.lines) {
        const p = latest.get(line.productId)
        if (p === undefined) {
          lines.push(line) // couldn't check (e.g. offline) - keep as is
        } else if (p === null || p.availableQty <= 0) {
          notes.push(`${line.name} is no longer available and was removed.`)
        } else {
          const quantity = Math.min(line.quantity, p.availableQty)
          if (quantity < line.quantity) notes.push(`Only ${p.availableQty} × ${p.name} left - quantity reduced.`)
          if (p.priceCents !== line.priceCents) notes.push(`The price of ${p.name} has changed.`)
          lines.push({ ...line, name: p.name, unitLabel: p.unitLabel, priceCents: p.priceCents, quantity })
        }
      }
      if (notes.length) setDraft((d) => touch({ business: lines.length ? d.business : null, lines }))
      return notes
    },
    [draft.lines],
  )

  const clear = useCallback(() => setDraft(EMPTY), [])

  const value = useMemo<CartState>(() => {
    const itemCount = draft.lines.reduce((n, l) => n + l.quantity, 0)
    const subtotalCents = draft.lines.reduce((n, l) => n + l.priceCents * l.quantity, 0)
    return { ...draft, itemCount, subtotalCents, add, replaceWith, setQuantity, refresh, clear }
  }, [draft, add, replaceWith, setQuantity, refresh, clear])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartState {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>')
  return ctx
}
