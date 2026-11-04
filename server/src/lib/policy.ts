// Pilot policy values from the specification (BR-06, FR-23, section 7.3), kept in one place
// so the website can show the same numbers the server enforces (GET /api/config).
export const POLICY = {
  deliveryFeeCents: 2500, // fixed fee for the pilot service area (R25.00)
  sellerResponseMinutes: 30, // seller must accept or decline within 30 minutes
  paymentMinutes: 15, // online orders: pay within 15 minutes of the seller accepting
  courierClaimMinutes: 30, // BR-10: a ready delivery nobody has taken after this goes to support
  maxLinesPerOrder: 20,
  maxQuantityPerLine: 99,
  maxOrderTotalCents: 1_000_000, // R10 000
  // Pilot areas (spec 2.1: "explicitly configured Kuruman areas"). Sellers and couriers
  // choose from this list when they apply, so names always match.
  serviceAreas: ["Kuruman town", "Wrenchville", "Mothibistad", "Seoding", "Batlharos", "Bankhara-Bodulong"],
  vehicleTypes: ["on_foot", "bicycle", "motorbike", "car", "bakkie"],
  // Why a courier couldn't hand an order over (spec FR-15, UC: "absence, invalid code or nonpayment").
  deliveryFailReasons: ["customer_absent", "wrong_address", "customer_refused", "no_payment"],
  // The terms of use, returns & refunds policy and privacy notice everyone accepts (the "I agree" box).
  // Change it whenever any of them changes: everyone is then asked to accept the new version.
  termsVersion: "2026-11-04",
  // The seller terms and privacy notice a seller agrees to when applying: the date each last changed.
  // The agreed versions are saved with the application, so we can show what someone agreed to.
  sellerTermsVersion: "2026-11-04",
  courierTermsVersion: "2026-11-04",
  privacyNoticeVersion: "2026-11-04",
  maxIdDocumentBytes: 5 * 1024 * 1024, // 5 MB: a phone photo (shrunk first on the phone) or a PDF
  // On when Payfast is configured in .env (a getter, so it reads the settings when asked).
  get onlinePaymentAvailable() {
    return Boolean(process.env.PAYFAST_MERCHANT_ID && process.env.PAYFAST_MERCHANT_KEY);
  },
};
