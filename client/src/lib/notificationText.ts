import { formatRand } from './money'

// Turns a notification's template key and values into a sentence (spec FR-17: "locale
// templates"). The server stores only the key and values, so the words live here - one place
// to have them reviewed by fluent Setswana and Afrikaans speakers later.
type Args = Record<string, any>

const TEMPLATES: Record<string, (a: Args) => string> = {
  'seller.new_order': (a) => `New order ${a.orderNumber}. Accept or decline within 30 minutes.`,
  'seller.order_paid': (a) => `Order ${a.orderNumber} is paid online. You can prepare it.`,
  'seller.cancelled_by_customer': (a) => `The customer cancelled order ${a.orderNumber}.`,
  'seller.cancelled_by_support': (a) => `Support cancelled order ${a.orderNumber}.`,
  'seller.delivery_failed': (a) => `Order ${a.orderNumber} couldn’t be delivered. Support is deciding what happens next.`,
  'customer.accepted': (a) => `The seller accepted order ${a.orderNumber}. Pay in cash when you get it.`,
  'customer.accepted_pay_now': (a) => `The seller accepted order ${a.orderNumber}. Pay online within 15 minutes.`,
  'customer.payment_received': (a) => `Payment received for order ${a.orderNumber}. Thank you!`,
  'customer.declined': (a) => `Order ${a.orderNumber} was declined${a.reason ? `: ${a.reason}` : ''}.`,
  'customer.expired_no_reply': (a) => `Order ${a.orderNumber} expired because the seller didn’t reply in time. Nothing was charged.`,
  'customer.expired_unpaid': (a) => `Order ${a.orderNumber} expired because it wasn’t paid within 15 minutes.`,
  'customer.cancelled_by_support': (a) => `Support cancelled order ${a.orderNumber}. See the order for details.`,
  'customer.ready_pickup': (a) => `Order ${a.orderNumber} is ready to collect. Show your code to the seller.`,
  'customer.ready_delivery': (a) => `Order ${a.orderNumber} is packed and waiting for a courier.`,
  'customer.on_the_way': (a) => `Order ${a.orderNumber} is on its way. Have your code ready for the courier.`,
  'customer.delivery_retry': (a) => `We’re trying to deliver order ${a.orderNumber} again.`,
  'customer.delivery_failed': (a) => `Order ${a.orderNumber} couldn’t be delivered. Support will contact you.`,
  'customer.completed': (a) => `Order ${a.orderNumber} is complete. Enjoy!`,
  'customer.refunded': (a) => `${formatRand(a.amountCents)} was refunded for order ${a.orderNumber}.`,
  'applicant.approved': (a) => `Your application to ${a.kind === 'seller' ? 'sell' : 'deliver'} was approved. Welcome!`,
  'applicant.rejected': (a) => `Your application to ${a.kind === 'seller' ? 'sell' : 'deliver'} wasn’t approved: ${a.reason}`,
  'privacy.held': () => 'Your request to close your account is on hold. See your Profile for the reason.',
}

export function notificationText(template: string, args: Args): string {
  return TEMPLATES[template]?.(args) ?? 'You have an update.'
}

// Where tapping the notification takes you.
export function notificationLink(template: string): string {
  if (template.startsWith('seller.')) return '/seller'
  if (template.startsWith('customer.')) return '/orders'
  return '/profile'
}
