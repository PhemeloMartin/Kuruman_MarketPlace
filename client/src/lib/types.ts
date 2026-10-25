// pickup: the customer collects; delivery: a KurumanMarketPlace courier; seller_delivery: the shop's own vehicle.
export type Fulfilment = 'pickup' | 'delivery' | 'seller_delivery'

export const FULFILMENT_LABEL: Record<Fulfilment, string> = {
  pickup: 'Pickup',
  delivery: 'Courier delivery',
  seller_delivery: 'Seller delivers',
}

export type Role = 'consumer' | 'entrepreneur' | 'courier' | 'support'

export interface User {
  id: number
  phone: string
  displayName: string
  role: Role
  preferredLanguage: 'en' | 'tn' | 'af'
  staffScopes: StaffScope[] // support staff only
  mfaVerified: boolean // support: this session passed the authenticator-code step
}

export type StaffScope = 'approvals' | 'payments' | 'operations' | 'audit' | 'privacy'

export interface Category {
  id: number
  slug: string
  name: string
  productCount?: number // products on sale in it (missing in an older saved offline copy)
}

export interface Product {
  id: number
  name: string
  description: string | null
  unitLabel: string
  priceCents: number
  imageUrl: string | null
  collectionOnly: boolean // too big or alive for a courier: customers collect it
  availableQty: number
  category: string
  categoryName: string
  business: { id: number; name: string; area: string; ownDeliveryFeeCents?: number | null; kind?: 'shop' | 'market_stall' }
  photos?: string[] // all photos, first = main; only on the single-product answer
  businessRating?: Rating // only on the single-product answer
  businessWhatsapp?: string | null // only if the seller chose to show it
}

export interface Rating {
  average: number | null
  count: number
}

export interface Review {
  id: number
  rating: number
  comment: string | null
  firstName: string
  createdAt: string
  sellerReply: string | null
  sellerRepliedAt: string | null
  themes: string[]
}

// Entrepreneur of the Month (GET /api/spotlight).
export interface Spotlight {
  business: { id: number; name: string; area: string; description: string | null; coverPhotoUrl: string | null }
  completedOrders: number
  averageRating: number
  reviewCount: number
  acceptanceRate: number | null
  score: number
  periodDays: number
  rule: string
}

// A shop's public page (GET /api/shops/:id).
export interface Shop {
  id: number
  name: string
  description: string | null
  area: string
  coverPhotoUrl: string | null
  sellingSince: string
  whatsapp: string | null // only if the seller chose to show it
  ownDeliveryFeeCents: number | null // the shop delivers with its own vehicle at this fee (null = it doesn't)
  ownDeliveryNote: string | null
  kind: 'shop' | 'market_stall'
  stall: { location: string | null; days: number[]; opens: string | null; closes: string | null; hereNow: boolean } | null
  products: Product[]
  rating: Rating
  reviews: Review[]
  isSpotlight: boolean
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
  fulfilment: Fulfilment
  paymentMethod: 'cash' | 'online'
  subtotalCents: number
  deliveryFeeCents: number
  totalCents: number
  notes: string | null
  acceptBy: string
  createdAt: string
  updatedAt: string
  customerName: string
  delivery: {
    status: string
    courierName: string | null
    released: boolean
    failedReason: string | null
    awaitingReturn: boolean // cancelled after a failed delivery; goods on their way back
  } | null
  cashStatus: 'collected' | 'remitted' | 'disputed' | null
  items: { name: string; unitLabel: string; quantity: number }[]
}

export interface CashToConfirm {
  orderId: number
  orderNumber: string
  collectedCents: number
  remittedCents: number
  status: 'collected' | 'disputed'
  courierName: string
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
  imageUrl: string | null
  collectionOnly: boolean
  barcode: string | null
  category: string
  categoryName: string
}

// Market stall days are ISO weekdays (1 = Monday). "Mon-Sat" reads better than a list of six days.
const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export function stallDaysText(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b)
  if (!sorted.length) return ''
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1)
  return consecutive && sorted.length > 2 ? `${DAY[sorted[0]]}–${DAY[sorted[sorted.length - 1]]}` : sorted.map((d) => DAY[d]).join(', ')
}
