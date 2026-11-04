import { Link } from 'react-router-dom'
import { LEGAL, TERMS_DATE, isPlaceholder } from '../lib/legal'

// The details the law asks an online shop to show (ECTA section 43), shown on the terms, returns and
// privacy pages. Details still to be filled in (lib/legal.ts) are marked so they're easy to spot.
export function WhoWeAre() {
  const row = (label: string, value: string, link?: string) => (
    <>
      <dt>{label}</dt>
      <dd className={isPlaceholder(value) ? 'to-fill' : undefined}>{link && !isPlaceholder(value) ? <a href={link}>{value}</a> : value}</dd>
    </>
  )
  return (
    <dl className="details who-we-are">
      {row('Trading as', LEGAL.tradingName)}
      {row('Run by', `${LEGAL.operator}, ${LEGAL.legalStatus}`)}
      {row('Registration number', LEGAL.registrationNumber)}
      {row('Address (also for legal documents)', LEGAL.physicalAddress)}
      {row('Phone', LEGAL.phone, `tel:${LEGAL.phone.replace(/\s/g, '')}`)}
      {row('Email', LEGAL.email, `mailto:${LEGAL.email}`)}
      {row('Website', LEGAL.website, LEGAL.website)}
      {row('Help', 'Ask a question under Help on this site', '/help')}
    </dl>
  )
}

// Terms of use for everyone who buys on KurumanMarketPlace. Plain language, as the Consumer Protection Act
// (section 22) requires. Sellers also accept the seller terms; everyone accepts these, the returns &
// refunds policy and the privacy notice in the "I agree" box. Have them checked by someone who knows
// consumer law before relying on them in a dispute.
export function TermsPage() {
  return (
    <main className="page prose">
      <p className="eyebrow">Version of {TERMS_DATE}</p>
      <h1 className="page-title" style={{ marginTop: 0 }}>
        Terms of use
      </h1>
      <p>
        These terms explain how KurumanMarketPlace works and what you and we agree to when you use it. Please read
        them with our <Link to="/returns">returns &amp; refunds policy</Link> and our{' '}
        <Link to="/privacy">privacy notice</Link>. If anything here takes away a right the law gives you, the law wins.
      </p>

      <h2>1. Who we are</h2>
      <WhoWeAre />

      <h2>2. What KurumanMarketPlace is</h2>
      <ul>
        <li>
          An online market where local sellers in Kuruman – shops, home businesses and market stalls – sell to customers,
          and local couriers deliver.
        </li>
        <li>
          <strong>When you buy, you buy from the seller.</strong> The seller is responsible for the goods: what they
          are, their quality and their safety. We run the site, check every seller before they can sell, handle online
          payments and help when something goes wrong.
        </li>
      </ul>

      <h2>3. Your account</h2>
      <ul>
        <li>You sign in with your own phone number and a one-time SMS code. One account per person.</li>
        <li>You are 18 or older, or you use the site with your parent’s or guardian’s permission.</li>
        <li>Keep your phone and codes to yourself. Tell us at once under Help if you think someone else used your account.</li>
      </ul>

      <h2>4. Prices and what you see</h2>
      <ul>
        <li>
          Prices are in South African rand and are the full price of the item. A delivery fee, if any, is shown
          separately before you send your order, and the total you will pay is shown on the button.
        </li>
        <li>Product descriptions and photos come from the seller. Sellers must use their own photos of what they sell.</li>
      </ul>

      <h2>5. How an order works</h2>
      <ol>
        <li>When you send an order, you offer to buy those items from that seller.</li>
        <li>
          The seller has 30 minutes to accept or decline. If they don’t answer, the order is cancelled and you pay
          nothing. <strong>The sale is agreed only when the seller accepts.</strong>
        </li>
        <li>
          You collect the order, or a courier or the seller delivers it, depending on what you chose. Show your
          one-time collection code only when you have the goods in front of you: giving the code confirms you received
          them.
        </li>
        <li>You get updates in the app and by SMS. You can see every order and its history under Orders.</li>
      </ol>

      <h2>6. Paying</h2>
      <ul>
        <li>
          <strong>Cash:</strong> you pay the seller or the courier when you receive the goods.
        </li>
        <li>
          <strong>Online:</strong> after the seller accepts, you pay on Payfast’s secure page within 15 minutes. Your
          card or bank details go to Payfast only – never to us or the seller. Your order is paid only when Payfast
          confirms it to us.
        </li>
        <li>
          Never pay a seller outside the site (for example a deposit by eWallet or EFT to their own account). We can’t
          protect or refund money paid that way. Please report anyone who asks, under Help.
        </li>
      </ul>

      <h2>7. Cancelling, returns and refunds</h2>
      <p>
        You may cancel before the seller accepts. After that, our <Link to="/returns">returns &amp; refunds policy</Link>{' '}
        applies, including your 7-day cooling-off right for online purchases (ECTA section 44) and your right to return
        faulty goods within 6 months (Consumer Protection Act section 56).
      </p>

      <h2>8. Delivery</h2>
      <ul>
        <li>We deliver in the Kuruman area shown when you choose delivery. The fee is shown before you order.</li>
        <li>Heavy or living items (for example building materials or livestock) are collected, or delivered by the seller.</li>
        <li>
          If a courier can’t hand over your order, support decides with you what happens next – another try, or
          cancelling it with a refund of anything you paid online.
        </li>
      </ul>

      <h2>9. Reviews</h2>
      <ul>
        <li>You can review an order you received, once, within 30 days. Only your first name is shown.</li>
        <li>Be honest and fair. No insults, no phone numbers, no advertising, and no reviews for anyone in return for something.</li>
        <li>We may hide a review that breaks these rules. We never change what you wrote.</li>
      </ul>

      <h2>10. Calls, messages and AI</h2>
      <ul>
        <li>
          Free calls on the site go over mobile data. Neither side sees the other’s number. Calls are limited in
          length and number.
        </li>
        <li>
          Some features use our own AI: category suggestions, review summaries, sales forecasts and spotting scams. The
          AI only advises – a person always decides, and the AI never hides, removes or changes anything by itself.
        </li>
      </ul>

      <h2>11. Using the site fairly</h2>
      <p>
        Don’t use the site to break the law, cheat or harass anyone, sell what isn’t allowed, or try to get around how it
        works (for example taking sales off the site). We may suspend an account that does. Every such decision is
        recorded with a reason, and you can ask us about it under Help.
      </p>

      <h2>12. Our responsibility</h2>
      <p>
        We work to keep the site safe and available, but it may sometimes be offline for maintenance or problems
        beyond our control. Nothing in these terms limits your rights under the Consumer Protection Act, or our
        responsibility where we were grossly negligent or acted on purpose.
      </p>

      <h2>13. Complaints and disputes</h2>
      <ol>
        <li>
          First, tell us under <Link to="/help">Help</Link>. We aim to answer within 2 working days.
        </li>
        <li>
          If we can’t solve it together, you may contact the Consumer Goods and Services Ombud (CGSO,{' '}
          <a href="https://www.cgso.org.za">cgso.org.za</a>) or the National Consumer Commission (
          <a href="https://thencc.org.za">thencc.org.za</a>). For privacy complaints: the Information Regulator (
          <a href="https://inforegulator.org.za">inforegulator.org.za</a>).
        </li>
        <li>These terms are governed by the law of South Africa.</li>
      </ol>

      <h2>14. Changes to these terms</h2>
      <p>
        If we change these terms, we tell you in the app and ask you to accept the new version before you carry on. The
        date at the top shows which version this is, and we keep a record of the version you accepted.
      </p>

      <p style={{ marginTop: 24 }}>
        <Link to="/" className="btn btn-outline btn-block">
          Back to the market
        </Link>
      </p>
    </main>
  )
}
