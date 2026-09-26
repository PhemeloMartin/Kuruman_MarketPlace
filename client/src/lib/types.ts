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

export type StaffScope = 'approvals' | 'payments' | 'operations' | 'audit'

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
  category: string
  categoryName: string
}
