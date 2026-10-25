import type { ReactNode } from 'react'

// The "markets" on the Home screen. A market is simply a product category from the server
// (GET /api/categories); this file adds what the Home screen shows for it: the order, a short
// line of text and a picture.
//
// Pictures are drawn in code (SVG), like the rest of the artwork: original, tiny, no licensing
// questions. To use a real photo instead (e.g. from the market day, with permission), put it in
// client/public/markets/ and set `photo`, for example photo: '/markets/building.webp'.

export interface MarketInfo {
  slug: string
  blurb: string
  art: ReactNode
  photo?: string
}

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
  {
    slug: 'building',
    blurb: 'Bricks, sand, cement',
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
  {
    slug: 'household',
    blurb: 'Pots, cleaning, home things',
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
