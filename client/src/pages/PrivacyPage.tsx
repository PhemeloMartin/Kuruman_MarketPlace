import { Link } from 'react-router-dom'

// Privacy notice (spec C.3 checklist, FR-20, Table 38). Written in plain language.
// Status: a DRAFT for the academic demonstration. Before any real person registers, the
// responsible party and Information Officer must be named, retention periods approved, and the
// Setswana and Afrikaans versions reviewed by fluent speakers (spec 9.4, NFR-09).
export function PrivacyPage() {
  return (
    <main className="page prose">
      <p className="eyebrow">Draft – demonstration only</p>
      <h1 className="page-title" style={{ marginTop: 0 }}>
        How we use your information
      </h1>
      <p className="notice">
        This notice is a draft for a student project. The app currently holds only made-up demonstration data. Before
        real people use it, the organisation responsible and its Information Officer will be named here, and the
        wording will be checked in all three languages.
      </p>

      <h2>Who is responsible</h2>
      <p>
        <strong>[Responsible party – to be named before real use]</strong>, Kuruman, Northern Cape.
        <br />
        Information Officer: <strong>[name and contact – to be named]</strong>.
      </p>

      <h2>What we collect, and why</h2>
      <ul>
        <li>
          <strong>Your phone number and name</strong> – to sign you in and so sellers and couriers know who an order is
          for. Required: without them you can’t order.
        </li>
        <li>
          <strong>Your passphrase</strong> – stored only in scrambled form (a one-way hash). Nobody, including us, can
          read it.
        </li>
        <li>
          <strong>Delivery address and notes</strong> – only for delivery orders, to get the order to you.
        </li>
        <li>
          <strong>Your orders, payments and refunds</strong> – so everyone can see what was bought, paid and handed
          over. Card details never reach us: online payments happen on Payfast’s own page.
        </li>
        <li>
          <strong>Sellers:</strong> business name, area, pickup address and phone – shown to customers so they can buy
          and collect. <strong>Couriers:</strong> how you deliver and your area.
        </li>
      </ul>
      <p>We don’t ask for ID numbers or dates of birth, we don’t send marketing, and we don’t build profiles of what you buy.</p>

      <h2>Who can see it</h2>
      <ul>
        <li>A seller sees your name and order – not your phone number or address.</li>
        <li>A courier sees your name, phone and address only while delivering your order, and loses access after.</li>
        <li>
          Support staff see details only when handling a case about your order, and every time they look at a phone
          number it is recorded.
        </li>
        <li>Payfast processes online payments under its own privacy terms.</li>
      </ul>

      <h2>How long we keep it (proposed)</h2>
      <ul>
        <li>Delivery addresses: removed 30 days after the order is finished, unless a problem with it is still open.</li>
        <li>Order, payment and refund records: kept as business records for the approved period.</li>
        <li>Your account: until you ask us to close it.</li>
        <li>Records of support decisions: 90 days after the case closes, unless needed for a dispute.</li>
      </ul>

      <h2>Your rights</h2>
      <ul>
        <li>
          <strong>See your information</strong> – download it any time from your Profile.
        </li>
        <li>
          <strong>Correct it</strong> – change your name on your Profile, or ask support to correct anything else.
        </li>
        <li>
          <strong>Close your account</strong> – ask from your Profile. We remove your phone number, passphrase, name and
          addresses. Records of orders and payments stay, marked “Closed account”, because sellers and couriers need
          them for their own records and the law may require them. If an order or refund is still in progress, we’ll
          tell you and close the account once it’s finished.
        </li>
      </ul>
      <p>We aim to reply within 2 business days and finish within 30 days. You may also complain to the Information Regulator of South Africa.</p>

      <p style={{ marginTop: 24 }}>
        <Link to="/profile" className="btn btn-outline btn-block">
          Back to your profile
        </Link>
      </p>
    </main>
  )
}
