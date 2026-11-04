import { Link } from 'react-router-dom'
import { TERMS_DATE } from '../lib/legal'

// Courier terms: what a courier agrees to when applying to deliver (the box on the "Apply to deliver"
// form). The version is saved with each application (server: POLICY.courierTermsVersion). They come on top
// of the terms of use everyone accepts. Plain language; have them checked before relying on them.
export function CourierTermsPage() {
  return (
    <main className="page prose">
      <p className="eyebrow">Version of {TERMS_DATE}</p>
      <h1 className="page-title" style={{ marginTop: 0 }}>
        Courier terms
      </h1>
      <p>
        These terms are between you, the courier, and KurumanMarketPlace. Couriers go to people’s homes and carry their
        orders and their money, so these rules keep customers, sellers and you safe. They come on top of the{' '}
        <Link to="/terms">terms of use</Link> that everyone accepts.
      </p>

      <h2>1. Who can deliver</h2>
      <ul>
        <li>You are 18 or older and have a South African ID (or a valid permit).</li>
        <li>
          You have a police clearance certificate from SAPS, or you have applied for one. SAPS can take weeks, so you
          may apply with proof that you applied; you then send the certificate within 30 days of being approved.
        </li>
        <li>
          If you deliver with a motorbike, car or bakkie: you have a valid driver’s licence for that vehicle, and the
          vehicle is licensed and roadworthy. On foot or by bicycle, no licence is needed.
        </li>
      </ul>

      <h2>2. We check who you are</h2>
      <ul>
        <li>
          You give us your email address and copies of your ID document, your police clearance certificate and (if you
          drive) your driver’s licence. Our support team checks them and may phone you before you can deliver.
        </li>
        <li>We may refuse an application, and we tell you why.</li>
        <li>
          Couriers approved before these checks began send the same documents within 14 days. Documents still missing
          after their due date mean you can finish the deliveries you have but can’t take new ones until we have
          checked them. You send them on your Deliveries page.
        </li>
        <li>
          Your documents are stored encrypted, only the support team can open them, and they are deleted 30 days after
          we decide (<Link to="/privacy">privacy notice</Link>).
        </li>
        <li>Tell us at once if your licence is suspended or anything on your police clearance changes.</li>
      </ul>

      <h2>3. Taking and doing a delivery</h2>
      <ol>
        <li>Take only a job you can deliver now. If you can’t after all, tell support straight away.</li>
        <li>Collect the order from the seller only after they hand it over to you in the app.</li>
        <li>
          Hand the order over only to the customer, and only when they give you their one-time code. Never ask for the
          code before they have the goods.
        </li>
        <li>
          If you can’t hand it over (nobody home, wrong address, refused), mark it with the reason. Support decides what
          happens next; bring the goods back to the seller if asked.
        </li>
      </ol>

      <h2>4. Cash</h2>
      <ul>
        <li>
          When a customer pays cash, you hold that money for the seller. Give all of it to the seller the same day; the
          app records what you collected and what the seller confirms receiving.
        </li>
        <li>Never ask a customer to pay you more, or to pay any other way.</li>
      </ul>

      <h2>5. Customers’ information</h2>
      <p>
        You see a customer’s name, phone number and address only while you deliver their order. Use them only for that
        delivery: don’t save, share or use them afterwards (POPIA).
      </p>

      <h2>6. Safety and conduct</h2>
      <ul>
        <li>Obey the rules of the road. No alcohol or drugs while delivering.</li>
        <li>Be polite and respectful to customers and sellers.</li>
        <li>Keep food clean and covered, and goods dry and undamaged.</li>
        <li>You are responsible for your vehicle, its licence and insurance, and any traffic fines.</li>
      </ul>

      <h2>7. Fees</h2>
      <p>
        The delivery fee is shown to the customer before they order. You deliver as an independent courier, not as an
        employee. How and when your fees are paid to you is agreed with you in writing when your application is
        approved.
      </p>

      <h2>8. When we may suspend you</h2>
      <p>
        If you break these terms, or customers are put at risk, support may stop you from taking new jobs. Every such
        decision is recorded with a reason, and you can ask about it under <Link to="/help">Help</Link>.
      </p>

      <h2>9. Leaving, and changes</h2>
      <ul>
        <li>You may stop delivering and close your account at any time, from your Profile.</li>
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
