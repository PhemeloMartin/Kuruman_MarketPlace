import { Link } from 'react-router-dom'

// Seller terms: what a seller agrees to when applying (the box on the "Apply to sell" form). The
// version date is saved with each application (server: POLICY.sellerTermsVersion), so we can always
// show what someone agreed to. Plain language, like the privacy notice. Before relying on it in a
// dispute, have it checked against the Consumer Protection Act, ECTA and POPIA.
export function SellerTermsPage() {
  return (
    <main className="page prose">
      <p className="eyebrow">Version of 3 November 2026</p>
      <h1 className="page-title" style={{ marginTop: 0 }}>
        Seller terms
      </h1>
      <p>
        These terms are between you, the seller, and KurumanMarketPlace. They keep buying safe for customers in
        Kuruman and fair for every seller. If something is unclear, ask support before you apply.
      </p>

      <h2>1. Who can sell</h2>
      <ul>
        <li>You are 18 or older and have a South African ID (or a valid permit).</li>
        <li>You sell from a real shop, home business or market stall in the Kuruman area.</li>
        <li>Everything you tell us is true, and you keep it up to date.</li>
      </ul>

      <h2>2. We check who you are</h2>
      <ul>
        <li>
          You give us your email address and a copy of your ID document. Our support team checks it against your
          name, and may phone or email you, before you can sell.
        </li>
        <li>We may refuse an application, and we tell you why.</li>
        <li>
          How we protect your ID document is in the <Link to="/privacy">privacy notice</Link>: encrypted, opened only by
          the support team, and deleted 30 days after we decide.
        </li>
      </ul>

      <h2>3. What you may sell</h2>
      <ul>
        <li>Only things you are allowed to sell, and that are yours to sell.</li>
        <li>
          Not allowed: alcohol, tobacco and vapes, medicines, weapons, fake or stolen goods, and protected plants or
          wild animals.
        </li>
        <li>Food must be fresh, clean and safe. Livestock must be healthy and legally yours, with papers where the law asks for them.</li>
      </ul>

      <h2>4. Your listings</h2>
      <ul>
        <li>Names, descriptions and prices are honest. The price is what the customer pays, in rand.</li>
        <li>Photos are your own, of what you really sell.</li>
        <li>You keep your stock up to date, so customers don’t order what you don’t have.</li>
      </ul>

      <h2>5. Orders</h2>
      <ul>
        <li>You accept or decline each order within 30 minutes; otherwise it is cancelled for the customer.</li>
        <li>You hand over an order only when the customer (or courier) gives the right collection code.</li>
        <li>
          All payments go through KurumanMarketPlace: cash when the customer collects, or online through Payfast. Never
          ask a customer to pay outside the site (for example a deposit by eWallet or EFT). Listings that do are taken
          off sale.
        </li>
      </ul>

      <h2>6. Online payments</h2>
      <p>
        When a customer pays online, the money is received through Payfast. How and when it is paid out to you is
        agreed with you in writing when your application is approved.
      </p>

      <h2>7. Your customers’ information</h2>
      <p>
        You see a customer’s name and order so you can serve them. Use it only for that order: don’t add customers to
        marketing lists or share their details (POPIA).
      </p>

      <h2>8. Reviews</h2>
      <p>
        Customers who received an order may review it. You may reply once, politely. Never write reviews for your own
        shop or ask someone to.
      </p>

      <h2>9. When we may hide a listing or close a shop</h2>
      <p>
        If you break these terms, or customers are put at risk, support may take a listing off sale or suspend your
        shop. Every such decision is recorded with a reason, and you may ask support to explain it.
      </p>

      <h2>10. Leaving, and changes</h2>
      <ul>
        <li>You may stop selling and close your account at any time, from your Profile.</li>
        <li>If we change these terms, we tell you first. The date at the top shows which version this is.</li>
      </ul>

      <p style={{ marginTop: 24 }}>
        <Link to="/profile" className="btn btn-outline btn-block">
          Back to your profile
        </Link>
      </p>
    </main>
  )
}
