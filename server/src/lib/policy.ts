// Pilot policy values from the specification (BR-06, FR-23, section 7.3), kept in one place
// so the website can show the same numbers the server enforces (GET /api/config).
export const POLICY = {
  deliveryFeeCents: 2500, // fixed fee for the pilot service area (R25.00)
  sellerResponseMinutes: 30, // seller must accept or decline within 30 minutes
  paymentMinutes: 15, // online orders: pay within 15 minutes of the seller accepting
  maxLinesPerOrder: 20,
  maxQuantityPerLine: 99,
  maxOrderTotalCents: 1_000_000, // R10 000
  // On when Payfast is configured in .env (a getter, so it reads the settings when asked).
  get onlinePaymentAvailable() {
    return Boolean(process.env.PAYFAST_MERCHANT_ID && process.env.PAYFAST_MERCHANT_KEY);
  },
};
