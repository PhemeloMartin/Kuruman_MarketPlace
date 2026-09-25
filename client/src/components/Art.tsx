// Decorative artwork, drawn in code (SVG): tiny to download, sharp on any screen,
// and original - no licensing questions. All of it is aria-hidden: it adds feeling, not information.

// Thin three-layer dune band across the top of every screen.
export function DuneRibbon() {
  return (
    <svg className="dune-ribbon" viewBox="0 0 390 14" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 0h390v6c-40 5-80 5-130 1S150 1 100 5 30 8 0 5z" fill="#1E6B5A" />
      <path d="M0 5c30 3 70 0 100 0s60 6 160 2 90-2 130-1v3c-50 4-90 1-140 3S150 8 100 9 30 10 0 9z" fill="#C8683F" />
      <path d="M0 9c30 1 70 0 100 0s60 4 150 2 100-2 140-1v4H0z" fill="#E9B98A" />
    </svg>
  )
}

// Logo: a sun over a dune, with water (the Eye of Kuruman spring) beneath it.
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="24" fill="#1E6B5A" />
      <circle cx="24" cy="22" r="7" fill="#F2C57C" />
      <path d="M4 31c7-6 13-6 20-2s13 4 20-1v6H4z" fill="#E9B98A" />
      <path d="M4 35c8-4 14-3 20 0s13 3 20 0v13H4z" fill="#C8683F" />
      <path d="M10 40c5-1.5 9-1.5 14 0s9 1.5 14 0" stroke="#DDF1EA" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}

// A Mokala (camel thorn, Vachellia erioloba) at sunset: wide flat-topped canopy,
// twisted trunk, red and sand dunes, and a thin line of oasis water.
export function MokalaScene({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 160 132" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1E6B5A" />
          <stop offset="0.55" stopColor="#6E8B5E" />
          <stop offset="1" stopColor="#F2C57C" />
        </linearGradient>
      </defs>
      <rect width="160" height="132" fill="url(#sky)" />
      <circle cx="104" cy="84" r="20" fill="#F2C57C" />
      <circle cx="104" cy="84" r="27" fill="#F2C57C" opacity="0.25" />
      {/* dunes */}
      <path d="M0 96c26-10 52-12 80-6s56 6 80-2v44H0z" fill="#E9B98A" />
      <path d="M0 108c30-8 60-6 88 0s50 4 72-2v28H0z" fill="#C8683F" />
      {/* oasis water */}
      <path d="M22 122c12-3 24-3 36 0s24 3 36 0 24-3 36 0" stroke="#DDF1EA" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* trunk and branches */}
      <g fill="#2A211B">
        <path d="M70 100c1-10-2-17 2-25 2-4 1-8-1-11l4-1c2 4 3 8 1 12-3 7 0 15-1 25z" />
        <path d="M72 76c-6-3-13-6-21-7l1-3c8 1 15 4 22 8z" />
        <path d="M73 70c6-5 13-8 22-9l1 3c-9 1-15 4-21 8z" />
        <path d="M71 66c-2-4-6-7-11-9l1-2c6 2 10 5 12 10z" />
      </g>
      {/* flat, wide canopy made of overlapping clumps */}
      <g fill="#1F3A2E">
        <ellipse cx="72" cy="56" rx="44" ry="7" />
        <ellipse cx="50" cy="52" rx="20" ry="6" />
        <ellipse cx="94" cy="52" rx="22" ry="6" />
        <ellipse cx="72" cy="49" rx="26" ry="6" />
        <ellipse cx="36" cy="57" rx="12" ry="4" />
        <ellipse cx="110" cy="57" rx="13" ry="4" />
      </g>
    </svg>
  )
}

// A small tree for empty screens ("Your cart is empty").
export function MokalaSmall() {
  return (
    <svg viewBox="0 0 120 80" aria-hidden="true">
      <path d="M0 70c20-6 40-7 60-3s40 4 60-1v14H0z" fill="#E9B98A" />
      <circle cx="84" cy="52" r="12" fill="#F2C57C" />
      <path d="M58 70c1-8-1-13 2-19 1-3 0-6-1-8h3c2 3 2 6 1 9-2 6 0 11-1 18z" fill="#5E574D" />
      <g fill="#1E6B5A">
        <ellipse cx="60" cy="40" rx="34" ry="5.5" />
        <ellipse cx="44" cy="37" rx="15" ry="4.5" />
        <ellipse cx="76" cy="37" rx="16" ry="4.5" />
        <ellipse cx="60" cy="34" rx="19" ry="4.5" />
      </g>
    </svg>
  )
}
