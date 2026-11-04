import { Link } from 'react-router-dom'
import { TERMS_DATE } from '../lib/legal'
import { WhoWeAre } from './TermsPage'

// Returns & refunds: what the law gives you (ECTA section 44 cooling-off, Consumer Protection Act sections
// 55-56 on faulty goods) and how it works on KurumanMarketPlace, where you buy from local sellers.
export function ReturnsPage() {
  return (
    <main className="page prose">
      <p className="eyebrow">Version of {TERMS_DATE}</p>
      <h1 className="page-title" style={{ marginTop: 0 }}>
        Returns &amp; refunds
      </h1>
      <p>
        You buy from local sellers; KurumanMarketPlace helps you and the seller sort out anything that goes wrong.
        Start every return or refund under <Link to="/help">Help</Link>, or with <strong>Report a problem</strong> on
        the order, so there is a record.
      </p>

      <h2>1. Before the seller accepts</h2>
      <p>
        Cancel the order under Orders at any time before the seller accepts. You pay nothing. If the seller declines or
        doesn’t answer within 30 minutes, the order is cancelled and you pay nothing either.
      </p>

      <h2>2. Seven days to change your mind (cooling-off)</h2>
      <ul>
        <li>
          Because you bought online, you may cancel the purchase of goods <strong>without giving a reason</strong> within{' '}
          <strong>7 days after you received them</strong> (Electronic Communications and Transactions Act, section 44).
        </li>
        <li>Return the goods unused and in their original condition. You pay only the direct cost of bringing them back.</li>
        <li>We refund what you paid within 30 days of your cancellation – usually much sooner.</li>
        <li>
          <strong>This doesn’t apply to</strong> goods that spoil quickly or can’t be returned by their nature – such as
          fresh produce, cooked food and bread – or goods made specially to your instructions (ECTA section 42). Live
          animals are not returned under the cooling-off once you have taken them home, except where the law requires
          it. Your rights for faulty goods (below) still apply.
        </li>
      </ul>

      <h2>3. Faulty, unsafe or not as described</h2>
      <ul>
        <li>
          Goods must be safe, of good quality, work as they should and match their description (Consumer Protection Act,
          section 55).
        </li>
        <li>
          If they don’t, you may return them <strong>within 6 months</strong> after you received them, and choose a{' '}
          <strong>repair, a replacement or your money back</strong> – at the seller’s cost, not yours (section 56). This
          doesn’t cover damage caused by misuse after you received them.
        </li>
        <li>
          For food: tell us the same day, with a photo if you can. Spoiled or unsafe food is replaced or refunded.
        </li>
      </ul>

      <h2>4. Wrong or missing items</h2>
      <p>
        Check your order when you receive it, before you show your collection code. If something is wrong or missing
        afterwards, report it within 7 days: the seller swaps it, delivers what’s missing, or refunds that part.
      </p>

      <h2>5. Delivery problems</h2>
      <p>
        If an order can’t be delivered, support decides with you what happens next: another try, or cancelling it. If you
        paid online, the cancelled order is refunded in full, including the delivery fee.
      </p>

      <h2>6. How refunds are paid</h2>
      <ul>
        <li>
          <strong>Paid online:</strong> refunded through Payfast to the card or account you paid with. It shows on the
          order as “Refunded” once Payfast confirms it. Your bank may take a few working days to show it.
        </li>
        <li>
          <strong>Paid in cash:</strong> the seller refunds you in cash, or we arrange it with you through support.
        </li>
        <li>You never pay a fee for a refund you’re entitled to.</li>
      </ul>

      <h2>7. How to ask</h2>
      <ol>
        <li>
          Open the order under <Link to="/orders">Orders</Link> and tap <strong>Report a problem</strong>, or ask under{' '}
          <Link to="/help">Help</Link>. Say what’s wrong and what you’d like (repair, replacement or refund).
        </li>
        <li>Keep the goods and packaging, and a photo if you can.</li>
        <li>We answer within 2 working days and keep you updated in the app and by SMS.</li>
      </ol>
      <p>
        Not happy with the outcome? See “Complaints and disputes” in our <Link to="/terms">terms of use</Link>.
      </p>

      <h2>Who we are</h2>
      <WhoWeAre />

      <p style={{ marginTop: 24 }}>
        <Link to="/" className="btn btn-outline btn-block">
          Back to the market
        </Link>
      </p>
    </main>
  )
}
