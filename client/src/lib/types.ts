export type Role = 'consumer' | 'entrepreneur' | 'courier' | 'support'

export interface User {
  id: number
  phone: string
  displayName: string
  role: Role
  preferredLanguage: 'en' | 'tn' | 'af'
}

export interface Category {
  id: number
  slug: string
  name: string
}

export interface Product {
  id: number
  name: string
  description: string | null
  unitLabel: string
  priceCents: number
  imageUrl: string | null
  availableQty: number
  category: string
  categoryName: string
  business: { id: number; name: string; area: string }
}
