import { Link } from 'react-router-dom'
import { marketPhotoCredits } from '../components/Markets'
import { EXAMPLE_PHOTOS } from '../lib/examplePhotos'

// Who took the photos on the site. Free licences (CC BY, CC BY-SA) ask for the photographer and licence to
// be named; this page does that for every photo that isn't our own.
export function PhotoCreditsPage() {
  return (
    <main className="page prose">
      <h1 className="page-title">Photo credits</h1>
      <p>
        The photos of Kuruman’s market stalls, caravans, take-aways, tailors and salons, and of the SMME Village, are
        our own, taken with the permission of the people and businesses in them.
      </p>
      <p>
        The other photos come from Wikimedia Commons under free licences. Each was cropped and made smaller for the
        site; the link opens the original with its licence.
      </p>

      <h2>Markets</h2>
      <ul>
        {marketPhotoCredits().map(({ what, credit }) => (
          <li key={credit.href}>
            {what}:{' '}
            <a href={credit.href} target="_blank" rel="noopener noreferrer">
              {credit.text.replace(/^(Photo|Picture): /, '')}
            </a>
          </li>
        ))}
      </ul>

      <h2>Example product photos</h2>
      <p>
        Until a seller adds a photo of their own, a product shows an example photo of its kind, labelled “Example
        photo”. The seller’s own photo replaces it.
      </p>
      <ul>
        {EXAMPLE_PHOTOS.map(({ what, credit }) => (
          <li key={what}>
            {what}:{' '}
            <a href={credit.href} target="_blank" rel="noopener noreferrer">
              {credit.text}
            </a>
          </li>
        ))}
      </ul>

      <p>
        <Link to="/" className="btn btn-outline btn-block">
          Back to the market
        </Link>
      </p>
    </main>
  )
}
