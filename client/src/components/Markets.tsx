import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

// The "markets" on the Home screen. A market is simply a product category from the server
// (GET /api/categories); this file adds what the Home screen shows for it: the order, a short
// line of text and a picture.
//
// Each market has a photo (client/public/markets/): our own from Kuruman, or one from Wikimedia
// Commons under a free licence that asks for the photographer and licence to be named (`credit`,
// shown when the market is opened). Under each photo stays a small drawing (SVG), which shows
// when the photo can't load, e.g. offline before the photo was ever seen.

interface Credit {
  text: string
  href: string
}

export interface MarketInfo {
  slug: string
  blurb: string
  art: ReactNode
  photo?: string
  credit?: Credit // for a photo that isn't ours
  gallery?: Gallery // more of our own photos, shown when the market is opened
}

type Gallery = { src: string; alt: string }[]

const commons = (who: string, licence: string, file: string): Credit => ({
  text: `Picture: ${who}, ${licence}, via Wikimedia Commons (cropped)`,
  href: `https://commons.wikimedia.org/wiki/File:${file}`,
})

const svg = (children: ReactNode, background: string) => (
  <svg viewBox="0 0 160 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="160" height="160" fill={background} />
    {children}
  </svg>
)

// Listed in the order they appear on the Home screen: everyday things first.
export const MARKETS: MarketInfo[] = [
  {
    slug: 'fresh-produce',
    blurb: 'Spinach, tomatoes, onions, fruit',
    photo: '/markets/fresh-produce.webp',
    credit: commons('Refiloe776', 'CC BY-SA 4.0', 'Johannesburg_Spinach_Hawkers.jpg'),
    art: svg(
      <>
        <circle cx="122" cy="34" r="16" fill="#F2C57C" />
        <ellipse cx="62" cy="78" rx="14" ry="26" fill="#1E6B5A" transform="rotate(-25 62 78)" />
        <ellipse cx="84" cy="74" rx="13" ry="28" fill="#2F8A73" transform="rotate(15 84 74)" />
        <circle cx="58" cy="100" r="17" fill="#C8432B" />
        <circle cx="88" cy="102" r="16" fill="#D9573A" />
        <circle cx="110" cy="100" r="14" fill="#B83A25" />
        <path d="M30 104h100l-12 40H42z" fill="#A8462A" />
        <path d="M36 118h88M40 131h80" stroke="#C8683F" strokeWidth="4" />
      </>,
      '#DDF1EA',
    ),
  },
  {
    slug: 'street-food',
    blurb: 'Kotas, vetkoek, pap and stew',
    photo: '/markets/street-food.webp', // our own photos from here on
    gallery: [
      { src: '/markets/gallery/food-caravan.webp', alt: 'A food caravan under a shade net, with a table and chairs' },
      { src: '/markets/gallery/food-menu.webp', alt: 'A caravan’s menu: pap, rice or dumpling with beef stew or steak, R80' },
      { src: '/markets/gallery/pots-on-the-fire.webp', alt: 'Pots cooking on a gas stove' },
      { src: '/markets/gallery/tea-stall-owner.webp', alt: 'The owner of a tea and bread stall in town, ready for customers' },
      { src: '/markets/gallery/tea-stall.webp', alt: 'Tea and bread under a shade net, across from the taxi rank' },
      { src: '/markets/gallery/sis-dee.webp', alt: 'The “Sis Dee” food trailer' },
      { src: '/markets/gallery/davids-cook.webp', alt: 'Dishing up pap at David’s Take Away' },
      { src: '/markets/gallery/davids-lunchtime.webp', alt: 'Lunchtime at David’s Take Away, Stall 23 at the Kuruman SMME Village' },
      { src: '/markets/gallery/davids-take-away.webp', alt: 'David’s Take Away at the Kuruman SMME Village' },
      { src: '/markets/gallery/joyces-fast-food.webp', alt: 'The sign of Joyce’s Fast Food' },
      { src: '/markets/gallery/dannys-fast-foods.webp', alt: 'Danny’s Fast Foods, open for the day' },
    ],
    art: svg(
      <>
        <path d="M62 26c-4 8 4 12 0 20M80 22c-4 8 4 12 0 20M98 26c-4 8 4 12 0 20" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.8" />
        <rect x="18" y="60" width="124" height="66" rx="12" fill="#FFFCF7" />
        <path d="M18 60h124l-8 16H26z" fill="#1E6B5A" />
        <path d="M34 60l-4 16M54 60l-2 16M74 60v16M94 60l2 16M114 60l4 16" stroke="#DDF1EA" strokeWidth="5" />
        <rect x="32" y="84" width="62" height="26" rx="4" fill="#2A211B" />
        <rect x="104" y="84" width="24" height="34" rx="3" fill="#E9B98A" />
        <circle cx="46" cy="130" r="11" fill="#22201C" />
        <circle cx="114" cy="130" r="11" fill="#22201C" />
        <circle cx="46" cy="130" r="4" fill="#E9B98A" />
        <circle cx="114" cy="130" r="4" fill="#E9B98A" />
        <rect x="0" y="140" width="160" height="20" fill="#A8462A" />
      </>,
      '#C8683F',
    ),
  },
  {
    slug: 'pantry',
    blurb: 'Bread, maize meal, groceries',
    photo: '/markets/pantry.webp',
    credit: commons('King of the Grasshoppers', 'CC BY-SA 4.0', 'Spaza_Shop,_Cathedral_Peak,_KwaZulu_Natal.JPG'),
    art: svg(
      <>
        <rect x="88" y="44" width="46" height="84" rx="6" fill="#FFFCF7" />
        <rect x="88" y="68" width="46" height="26" fill="#1E6B5A" />
        <path d="M96 52h30" stroke="#E9B98A" strokeWidth="4" strokeLinecap="round" />
        <path d="M22 128V92c0-18 14-30 36-30s36 12 36 30v36z" fill="#C8683F" />
        <path d="M22 100c0-16 14-26 36-26s36 10 36 26" fill="#E9B98A" />
        <path d="M40 84l6 12M56 80l4 14M72 82l2 14" stroke="#A8462A" strokeWidth="3" strokeLinecap="round" />
        <rect x="0" y="128" width="160" height="32" fill="#E9B98A" />
      </>,
      '#F2C57C',
    ),
  },
  // Water and books are markets with a Kuruman story (STORY_MARKETS below): their own photos.
  { slug: 'water', blurb: 'Filtered water, refills, ice', photo: '/markets/eye-of-kuruman.webp', art: null },
  {
    slug: 'building',
    blurb: 'Bricks, sand, cement',
    photo: '/markets/building.webp',
    credit: commons('Gabriel Fredrick Sindahnai', 'CC BY-SA 4.0', 'Stacked_bricks.jpg'),
    art: svg(
      <>
        <circle cx="128" cy="30" r="14" fill="#F2C57C" />
        <path d="M84 132c8-40 24-58 38-58s30 18 38 58z" fill="#E9B98A" />
        <path d="M100 110c6-8 12-12 22-12" stroke="#FFFCF7" strokeWidth="3" fill="none" opacity="0.6" />
        <g fill="#A8462A" stroke="#E9B98A" strokeWidth="2">
          <rect x="14" y="112" width="30" height="16" />
          <rect x="44" y="112" width="30" height="16" />
          <rect x="74" y="112" width="30" height="16" />
          <rect x="28" y="96" width="30" height="16" />
          <rect x="58" y="96" width="30" height="16" />
          <rect x="14" y="80" width="30" height="16" />
          <rect x="44" y="80" width="30" height="16" />
          <rect x="28" y="64" width="30" height="16" />
        </g>
        <rect x="0" y="128" width="160" height="32" fill="#5E574D" />
      </>,
      '#DDE6EE',
    ),
  },
  {
    slug: 'livestock',
    blurb: 'Goats, sheep, chickens, cattle',
    photo: '/markets/livestock.webp',
    credit: commons('Lazarus000', 'CC BY-SA 4.0', 'Boer_goat.jpg'),
    art: svg(
      <>
        <circle cx="34" cy="36" r="14" fill="#F2C57C" />
        <path d="M0 112c40-14 90-14 160-4v52H0z" fill="#E9B98A" />
        {/* Boer goat: white body, brown head, curved horns, floppy ear */}
        <g fill="#FFFCF7">
          <rect x="46" y="104" width="9" height="30" rx="4" />
          <rect x="60" y="106" width="9" height="28" rx="4" />
          <rect x="88" y="106" width="9" height="28" rx="4" />
          <rect x="100" y="104" width="9" height="30" rx="4" />
          <ellipse cx="78" cy="96" rx="38" ry="22" />
          <path d="M40 88c-8-4-10-10-6-14" stroke="#FFFCF7" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M104 92l10-22 14 4-6 24z" />
        </g>
        <path d="M112 64c-2-12 8-20 20-16" stroke="#5E574D" strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M110 74c4-12 14-16 24-12 6 6 6 16 2 24-4 6-12 8-18 4z" fill="#8A3B22" />
        <path d="M112 76c-8 2-12 8-12 16 6-2 10-6 12-12z" fill="#6B2C18" />
        <circle cx="126" cy="74" r="2.5" fill="#22201C" />
        <path d="M128 88c2 6 0 10-4 12" stroke="#FFFCF7" strokeWidth="3" fill="none" strokeLinecap="round" />
      </>,
      '#9FC9B9',
    ),
  },
  {
    slug: 'farm-feed',
    blurb: 'Lucerne, chicken feed, farm supplies',
    photo: '/markets/farm-feed.webp',
    credit: commons('Gary D Robson', 'CC BY-SA 3.0', 'Alfalfa_square_bales.jpg'),
    art: svg(
      <>
        <rect x="16" y="76" width="74" height="52" rx="6" fill="#D9B653" />
        <path d="M16 90h74M16 104h74M16 118h74" stroke="#B8962F" strokeWidth="3" />
        <path d="M40 76v52M66 76v52" stroke="#8C6E1E" strokeWidth="4" />
        <path d="M98 128V64c0-6 6-10 12-12l8-6 8 6c6 2 12 6 12 12v64z" fill="#FFFCF7" />
        <rect x="98" y="82" width="40" height="22" fill="#1E6B5A" />
        <circle cx="118" cy="93" r="6" fill="#F2C57C" />
        <rect x="0" y="128" width="160" height="32" fill="#C8683F" />
      </>,
      '#F2C57C',
    ),
  },
  {
    slug: 'clothing',
    blurb: 'Clothes, shoes, shweshwe',
    photo: '/markets/clothing.webp', // our own photos
    gallery: [
      { src: '/markets/gallery/dresses-and-suits.webp', alt: 'Dresses, gowns and suits made by a Kuruman tailor' },
      { src: '/markets/gallery/tailors-corridor.webp', alt: 'Traditional shirts and dresses on mannequins outside a tailor' },
    ],
    art: svg(
      <>
        <path d="M54 30l-36 22 12 24 16-8v66h68V68l16 8 12-24-36-22c-4 10-14 16-26 16s-22-6-26-16z" fill="#1E4E7A" />
        <g fill="#DDE6EE">
          <circle cx="62" cy="80" r="3" /><circle cx="80" cy="80" r="3" /><circle cx="98" cy="80" r="3" />
          <circle cx="71" cy="96" r="3" /><circle cx="89" cy="96" r="3" />
          <circle cx="62" cy="112" r="3" /><circle cx="80" cy="112" r="3" /><circle cx="98" cy="112" r="3" />
          <circle cx="71" cy="128" r="3" /><circle cx="89" cy="128" r="3" />
        </g>
      </>,
      '#F3C9B8',
    ),
  },
  {
    slug: 'crafts',
    blurb: 'Beadwork, baskets, gifts',
    photo: '/markets/crafts.webp',
    credit: commons('Aurobindo Ogra', 'CC BY-SA 3.0', 'Beadwork_Wire_Art_and_Crafts_(22).JPG'),
    art: svg(
      <>
        <circle cx="80" cy="78" r="44" fill="none" stroke="#154D41" strokeWidth="2" />
        {Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * Math.PI * 2
          const colours = ['#F2C57C', '#C8432B', '#FFFCF7', '#1E4E7A']
          return <circle key={i} cx={80 + 44 * Math.cos(a)} cy={78 + 44 * Math.sin(a)} r="6" fill={colours[i % 4]} />
        })}
        <path d="M70 124h20l-4 20h-12z" fill="#F2C57C" />
      </>,
      '#1E6B5A',
    ),
  },
  { slug: 'books', blurb: 'Local authors, study guides, lessons', photo: '/markets/moffat-mission.webp', art: null },
  {
    slug: 'household',
    blurb: 'Pots, cleaning, home things',
    photo: '/markets/household.webp',
    credit: {
      text: 'Picture: Digrpat, public domain, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Potjie4.jpg',
    },
    art: svg(
      <>
        <path d="M58 140c4-14 12-20 22-20s18 6 22 20z" fill="#F2C57C" />
        <path d="M66 140c3-9 8-12 14-12s11 3 14 12z" fill="#C8432B" />
        <ellipse cx="80" cy="62" rx="44" ry="8" fill="#2A211B" />
        <path d="M36 62c0 30 18 50 44 50s44-20 44-50z" fill="#22201C" />
        <path d="M44 112l-6 20M116 112l6 20M80 112v14" stroke="#22201C" strokeWidth="5" strokeLinecap="round" />
        <path d="M28 56c-6-6-6-14 2-16M132 56c6-6 6-14-2-16" stroke="#22201C" strokeWidth="4" fill="none" />
      </>,
      '#E9B98A',
    ),
  },
  {
    slug: 'personal-care',
    blurb: 'Soap, lotion, hair care',
    photo: '/markets/personal-care.webp', // our own photos
    gallery: [{ src: '/markets/gallery/siddiq-spa-window.webp', alt: 'The window of a Kuruman salon: braids, cuts and nails' }],
    art: svg(
      <>
        <rect x="56" y="54" width="40" height="76" rx="10" fill="#FFFCF7" />
        <rect x="68" y="34" width="16" height="20" rx="3" fill="#1E6B5A" />
        <rect x="56" y="80" width="40" height="22" fill="#DDF1EA" />
        <rect x="98" y="104" width="44" height="26" rx="8" fill="#F2C57C" />
        <circle cx="34" cy="58" r="8" fill="#FFFCF7" opacity="0.7" />
        <circle cx="26" cy="80" r="5" fill="#FFFCF7" opacity="0.7" />
        <rect x="0" y="130" width="160" height="30" fill="#C8683F" />
      </>,
      '#F6D9B5',
    ),
  },
]

// Wonderwerk Cave has no photo with a free licence, so it is drawn: the hill, the cave mouth, a fire inside.
// The fire sits high in the picture, so the market's name (over the bottom of the card) doesn't hide it.
const wonderwerkArt = svg(
  <>
    <circle cx="136" cy="16" r="9" fill="#F2C57C" />
    <path d="M-10 160C-6 50 34 12 80 12s86 38 90 148z" fill="#A8462A" />
    <path d="M14 70c20-6 40-8 60-6M100 44c18 0 32 6 46 14" stroke="#8A3B22" strokeWidth="4" fill="none" strokeLinecap="round" />
    <path d="M28 160c0-70 22-112 52-112s52 42 52 112z" fill="#2A211B" />
    <g transform="translate(0 -46)">
      <circle cx="80" cy="134" r="30" fill="#F2C57C" opacity="0.18" />
      <path d="M62 154l36-12M62 142l36 12" stroke="#6B2C18" strokeWidth="6" strokeLinecap="round" />
      <path d="M80 106c10 12 16 20 12 32-2 6-7 9-12 9s-10-3-12-9c-3-9 1-16 6-22 0 7 3 9 5 9-2-7-2-13 1-19z" fill="#D9573A" />
      <path d="M80 124c5 6 7 10 5 15-1 3-3 4-5 4s-4-1-5-4c-1-4 1-8 5-15z" fill="#F2C57C" />
    </g>
  </>,
  '#F6D9B5',
)

// Markets with a Kuruman story. The card keeps the market's plain name (people look for "Water", not for a
// name they first have to learn); the picture behind it and one line say whose story it carries, and opening
// the market tells that story. The photos are from Wikimedia Commons under licences that ask for the
// photographer and the licence to be named next to the photo - that is `credit`.
export interface StoryMarket {
  key: string
  name: string // the plain name (a product market shows the server's category name when it has one)
  honour: string // the line on the picture
  story: string // shown when the market is opened
  note?: string // something people must know there, e.g. what to do in an emergency
  photo?: string
  photoAlt?: string
  art?: ReactNode // a drawing, when there is no free photo
  cover?: string // the Home card's photo, when it isn't the story's own picture
  gallery?: Gallery // our own photos for a Business Directory market (product markets have them in MARKETS)
  credit?: { text: string; href: string }
  category?: string // a product market: opens /?market=<category>
  directory?: string // a Business Directory category: opens /directory?category=<directory>
  also?: { to: string; label: string } // a related place, e.g. tutors to call next to the books
}

export const STORY_MARKETS: StoryMarket[] = [
  {
    key: 'leitlho',
    category: 'water',
    name: 'Water & ice',
    honour: 'Leitlho · the Eye of Kuruman',
    story:
      'Leitlho means “the eye”. The Eye of Kuruman, Gasegonyana, is the spring that gives the town about 20 million litres of clean water every day: it’s why Kuruman is called the oasis of the Kalahari. This market is for the people who sell water: filtered and bottled water, refills, deliveries and ice.',
    photo: '/markets/eye-of-kuruman.webp',
    photoAlt: 'Water flowing out of the rock at the Eye of Kuruman',
    credit: {
      text: 'Photo: South African Tourism, CC BY 2.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:The_Eye,_Kuruman,_Northern_Cape,_South_Africa_(19919680754).jpg',
    },
  },
  {
    key: 'credo-mutwa',
    directory: 'health',
    name: 'Doctors & healers',
    honour: 'In honour of Credo Mutwa',
    story:
      'Vusamazulu Credo Mutwa (1921–2020) was a sangoma and healer, an author and an artist. He spent his last years in Kuruman, where he ran a clinic, and he is buried here. In Setswana a ngaka is a doctor and a traditional healer alike, so this market brings them together: surgeries, clinics and traditional healers you can call.',
    note: 'We list doctors and healers so you can call them; we don’t check medical claims, so ask whether they are registered. Medicines can’t be sold on KurumanMarketPlace. In an emergency, call 10177 for an ambulance (112 from a cellphone).',
    photo: '/markets/credo-mutwa.webp',
    photoAlt: 'Credo Mutwa in Soweto, 1997',
    gallery: [{ src: '/markets/gallery/lesego-muthi-shop.webp', alt: 'Lesego Muthi Shop in town: traditional medicine, wholesale and retail' }],
    credit: {
      text: 'Photo: oficinalis, 1997, CC BY-SA 4.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Credo_mutwa.jpg',
    },
  },
  {
    key: 'moffat-mission',
    category: 'books',
    name: 'Books & lessons',
    honour: 'Moffat Mission · Setswana in print',
    story:
      'At the Moffat Mission, Robert Moffat translated the whole Bible into Setswana, finished in 1857: the first complete Bible in an African language. The mission’s hand press, which printed books and lessons in Setswana, can still be seen there. This market is for local authors, books, study guides and extra lessons.',
    photo: '/markets/moffat-mission.webp',
    photoAlt: 'The thatched stone church at the Moffat Mission, Kuruman',
    credit: {
      text: 'Photo: Andrew Hall, CC BY-SA 3.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Church,_Moffat_Mission,_Kuruman.JPG',
    },
    also: { to: '/directory?category=lessons', label: 'Tutors you can call: Lessons & tutoring in the Business Directory' },
  },
  {
    key: 'wonderwerk',
    category: 'street-food',
    name: 'Street food & caravans',
    honour: 'Wonderwerk · a million years of fire',
    story:
      'Wonderwerk Cave, between Kuruman and Danielskuil, holds some of the oldest signs of people using fire, about a million years old. Wonderwerk means “miracle”. Kuruman still gathers around the fire, and this market is for food cooked at stalls and caravans: kotas, vetkoek, pap and stew.',
    art: wonderwerkArt,
    cover: '/markets/street-food.webp', // our own photo: the way to Kuruman's caravan park
  },
]

export const storyForCategory = (slug: string) => STORY_MARKETS.find((m) => m.category === slug)
export const storyForDirectory = (key: string) => STORY_MARKETS.find((m) => m.directory === key)
export const storyLink = (m: StoryMarket) => (m.directory ? `/directory?category=${m.directory}` : `/?market=${m.category}`)

// The story at the top of an opened market.
export function MarketStoryCard({ market }: { market: StoryMarket }) {
  return (
    <aside className="market-story" aria-label="About this market">
      <div className="market-story-art">{market.photo ? <img src={market.photo} alt={market.photoAlt ?? ''} /> : market.art}</div>
      <p className="market-story-honour">{market.honour}</p>
      <div className="market-story-text">
        <p>{market.story}</p>
        {market.also && (
          <p>
            <Link to={market.also.to}>{market.also.label}</Link>
          </p>
        )}
        {market.credit && (
          <p className="fine-print">
            <a href={market.credit.href} target="_blank" rel="noopener noreferrer">
              {market.credit.text}
            </a>
          </p>
        )}
      </div>
      {market.note && (
        <p className="notice market-story-note" role="note">
          {market.note}
        </p>
      )}
    </aside>
  )
}

// Under an opened market: our own photos from around Kuruman (swipe sideways), and who took the market's
// picture when it isn't ours.
export function MarketPictures({ info }: { info: { gallery?: Gallery; credit?: Credit } }) {
  if (!info.gallery && !info.credit) return null
  return (
    <div className="market-pictures">
      {info.gallery && (
        <figure>
          <div className="market-gallery" role="group" aria-label="Photos from around Kuruman" tabIndex={0}>
            {info.gallery.map((g) => (
              <img key={g.src} src={g.src} alt={g.alt} loading="lazy" width={640} height={480} />
            ))}
          </div>
          <figcaption className="fine-print">Photos taken around Kuruman.</figcaption>
        </figure>
      )}
      {info.credit && (
        <p className="fine-print">
          <a href={info.credit.href} target="_blank" rel="noopener noreferrer">
            {info.credit.text}
          </a>
        </p>
      )}
    </div>
  )
}

// A category the server has but this file doesn't know yet still gets a tile, with a plain picture.
export function marketInfo(slug: string): MarketInfo {
  return (
    MARKETS.find((m) => m.slug === slug) ?? {
      slug,
      blurb: 'Local sellers',
      art: svg(<circle cx="80" cy="80" r="30" fill="#F2C57C" />, '#DDF1EA'),
    }
  )
}

// Sort server categories into the Home screen's order; unknown ones go last.
export function orderMarkets<T extends { slug: string }>(categories: T[]): T[] {
  const rank = (slug: string) => {
    const i = MARKETS.findIndex((m) => m.slug === slug)
    return i === -1 ? MARKETS.length : i
  }
  return [...categories].sort((a, b) => rank(a.slug) - rank(b.slug))
}

// Wide Kuruman scene for the Home screen's top banner: sunset, red and sand dunes, Mokala trees
// and a row of market stalls. Built to sit behind the welcome card; can later be swapped for a
// photo or a short muted video of Kuruman.
export function KurumanPanorama() {
  return (
    <svg viewBox="0 0 800 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="pano-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#154D41" />
          <stop offset="0.5" stopColor="#6E8B5E" />
          <stop offset="1" stopColor="#F2C57C" />
        </linearGradient>
      </defs>
      <rect width="800" height="360" fill="url(#pano-sky)" />
      <circle cx="600" cy="200" r="60" fill="#F2C57C" />
      <circle cx="600" cy="200" r="84" fill="#F2C57C" opacity="0.25" />
      <path d="M0 240c120-30 260-36 400-16s280 20 400-6v142H0z" fill="#E9B98A" />
      {/* market stalls on the horizon */}
      <g>
        {[440, 492, 544, 690, 742].map((x, i) => (
          <g key={x}>
            <rect x={x} y="214" width="44" height="26" fill="#FFFCF7" />
            <path d={`M${x - 4} 214h52l-6-14h-40z`} fill={i % 2 ? '#A8462A' : '#1E6B5A'} />
          </g>
        ))}
      </g>
      <path d="M0 270c140-24 300-22 440 2s250 18 360-4v92H0z" fill="#C8683F" />
      <path d="M60 330c40-8 80-8 120 0s80 8 120 0" stroke="#DDF1EA" strokeWidth="5" fill="none" strokeLinecap="round" />
      {/* Mokala trees */}
      {[
        [210, 250, 1],
        [330, 262, 0.7],
      ].map(([x, y, s]) => (
        <g key={x} transform={`translate(${x} ${y}) scale(${s})`}>
          <path d="M-4 0c2-20-4-34 4-50 4-8 2-16-2-22l8-2c4 8 6 16 2 24-6 14 0 30-2 50z" fill="#2A211B" />
          <g fill="#1F3A2E">
            <ellipse cx="0" cy="-74" rx="90" ry="14" />
            <ellipse cx="-40" cy="-82" rx="40" ry="12" />
            <ellipse cx="44" cy="-82" rx="44" ry="12" />
            <ellipse cx="0" cy="-90" rx="52" ry="12" />
          </g>
        </g>
      ))}
    </svg>
  )
}
