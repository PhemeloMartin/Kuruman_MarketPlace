import type { Category, Product } from './types'

// Offline copy of the PUBLIC catalogue (spec 5.3, NFR-02). Only public data is stored:
// product names, prices, units, seller names and areas - never anything about a customer.
//   - saved with the time it was fetched, so the app can say how old it is
//   - older than 24 hours -> shown, but marked as out of date
//   - older than 7 days   -> thrown away
//   - at most 200 products

const KEY = 'kmp_catalogue_v1'
const MAX_PRODUCTS = 200
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000
const DISCARD_AFTER_MS = 7 * 24 * 60 * 60 * 1000

export interface SavedCatalogue {
  savedAt: string
  categories: Category[]
  products: Product[]
}

export function saveCatalogue(categories: Category[], products: Product[]): void {
  try {
    const data: SavedCatalogue = {
      savedAt: new Date().toISOString(),
      categories,
      products: products.slice(0, MAX_PRODUCTS),
    }
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // Storage full or blocked: the app still works online, it just can't offer offline browsing.
  }
}

export function loadCatalogue(): SavedCatalogue | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as SavedCatalogue
    if (Date.now() - new Date(data.savedAt).getTime() > DISCARD_AFTER_MS) {
      localStorage.removeItem(KEY)
      return null
    }
    return data
  } catch {
    return null
  }
}

// Offline, search and category filters work on the saved copy.
export function filterSaved(products: Product[], category: string, query: string): Product[] {
  const q = query.toLowerCase()
  return products.filter(
    (p) =>
      (!category || p.category === category) &&
      (!q || p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)),
  )
}
