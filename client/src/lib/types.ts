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

export interface Kpis {
  pendingOrders: number
  grossDeliveredCents: number
  completedOrders: number
  averageCompletedCents: number | null
  acceptanceRate: number | null
  unreconciledCashCents: number
  lowStockProducts: number
}

export interface SellerOrder {
  id: number
  orderNumber: string
  status: string
  fulfilment: 'pickup' | 'delivery'
  paymentMethod: 'cash' | 'online'
  subtotalCents: number
  deliveryFeeCents: number
  totalCents: number
  notes: string | null
  acceptBy: string
  createdAt: string
  updatedAt: string
  customerName: string
  items: { name: string; unitLabel: string; quantity: number }[]
}

export interface SellerProduct {
  id: number
  name: string
  description: string | null
  unitLabel: string
  priceCents: number
  stockQty: number
  reservedQty: number
  availableQty: number
  lowStockThreshold: number
  isActive: boolean
  category: string
  categoryName: string
}
