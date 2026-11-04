import { Link } from 'react-router-dom'
import { LEGAL, TERMS_DATE, isPlaceholder } from '../lib/legal'
import { WhoWeAre } from './TermsPage'

// Privacy notice (spec C.3 checklist, FR-20, Table 38). Written in plain language.
// Status: a DRAFT for the academic demonstration. Before any real person registers, the
// responsible party and Information Officer must be named, retention periods approved, and the
// Setswana and Afrikaans versions reviewed by fluent speakers (spec 9.4, NFR-09).
export function PrivacyPage() {
  return (
    <main className="page prose">
      <p className="eyebrow">Version of {TERMS_DATE}</p>
      <h1 className="page-title" style={{ marginTop: 0 }}>
        How we use your information
      </h1>
      <p>
        This notice explains what personal information KurumanMarketPlace collects, why, who can see it, how long we
        keep it, and your rights under the Protection of Personal Information Act (POPIA).
      </p>

      <h2>Who is responsible</h2>
      <WhoWeAre />
      <p>
        Information Officer:{' '}
        <strong className={isPlaceholder(LEGAL.informationOfficer) ? 'to-fill' : undefined}>{LEGAL.informationOfficer}</strong>,
        reachable at the contact details above or under <Link to="/help">Help</Link>.
      </p>

      <h2>What we collect, and why</h2>
      <ul>
        <li>
          <strong>Your phone number and name</strong> – to sign you in and so sellers and couriers know who an order is
          for. Required: without them you can’t order.
        </li>
        <li>
          <strong>Sign-in codes</strong> – you sign in with a one-time code we send by SMS. We keep only a scrambled
          form of each code (a one-way hash), and delete it after a day.
        </li>
        <li>
          <strong>Delivery address and notes</strong> – only for delivery orders, to get the order to you.
        </li>
        <li>
          <strong>Your delivery pin (optional)</strong> – if you share your location at checkout or while you wait, so
          the courier can find you. <strong>Couriers: your phone’s position</strong> while you deliver, so the customer
          can follow their order.
        </li>
        <li>
          <strong>Messages between you and the courier</strong> about a delivery (“I’m at the gate”), and calls through
          the site – to get the order to you.
        </li>
        <li>
          <strong>Your orders, payments and refunds</strong> – so everyone can see what was bought, paid and handed
          over. Card details never reach us: online payments happen on Payfast’s own page.
        </li>
        <li>
          <strong>Sellers:</strong> business name, area, pickup address and phone – shown to customers so they can buy
          and collect. <strong>Couriers:</strong> how you deliver and your area.
        </li>
        <li>
          <strong>Your help questions</strong> – what you write to support under Help, and our answers, so we can help
          you and see what happened before.
        </li>
        <li>
          <strong>Sellers applying to sell: your email address and a copy of your ID document</strong> – to check who
          you are before you can sell (so customers can trust the shops here), and to contact you about your
          application. You agree to this when you apply. The ID copy is stored encrypted, and used only for that check.
        </li>
        <li>
          <strong>Couriers applying to deliver: your email address, a copy of your ID document, your police clearance
          certificate and – if you drive – your driver’s licence</strong> – because couriers go to customers’ homes and
          carry their orders and money. Stored encrypted, used only to decide your application.
        </li>
      </ul>
      <p>
        Apart from the ID document sellers give us, we don’t ask for ID numbers or dates of birth. We don’t send
        marketing, and we don’t build profiles of what you buy.
      </p>

      <h2>Who can see it</h2>
      <ul>
        <li>A seller sees your name and order – not your phone number or address.</li>
        <li>
          A courier sees your name, phone, address and pin only while delivering your order, and loses access after.
          (A shop that delivers its own orders sees your address and pin only while it’s on its way.)
        </li>
        <li>
          A courier’s position is shown only to the customer of the order they are delivering, and only during that
          delivery. Your messages with the courier are seen only by the two of you.
        </li>
        <li>
          Support staff see details only when handling a case about your order, and every time they look at a phone
          number it is recorded.
        </li>
        <li>
          Sellers’ and couriers’ documents can be opened only by the support staff who approve applications, and
          every time one is opened is recorded. They are never emailed or shown to anyone else.
        </li>
        <li>Payfast processes online payments under its own privacy terms.</li>
      </ul>

      <h2>How long we keep it</h2>
      <ul>
        <li>
          Delivery addresses, pins and messages with the courier: removed 30 days after the order is finished, unless a
          problem with it is still open.
        </li>
        <li>A courier’s position: only the latest one is kept, and it is deleted when the delivery ends.</li>
        <li>Order, payment and refund records: kept as business records for the approved period.</li>
        <li>Your account: until you ask us to close it.</li>
        <li>Sellers’ and couriers’ documents: deleted 30 days after the application is decided (approved or not).</li>
        <li>Help questions and answers: deleted 12 months after the question is closed.</li>
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
          <strong>Close your account</strong> – ask from your Profile. We remove your phone number, name and addresses. Records of orders and payments stay, marked “Closed account”, because sellers and couriers need
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
