// Simple line icons (24 x 24). Decorative: the text label next to each icon carries the meaning.
const common = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export const HomeIcon = () => (
  <svg {...common}>
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
  </svg>
)

export const CartIcon = () => (
  <svg {...common}>
    <path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.4a1 1 0 0 0 1-.8L21 8H6.2" />
    <circle cx="9.5" cy="19.5" r="1.3" />
    <circle cx="17" cy="19.5" r="1.3" />
  </svg>
)

export const OrdersIcon = () => (
  <svg {...common}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M9 8h6M9 12h6M9 16h4" />
  </svg>
)

export const ProfileIcon = () => (
  <svg {...common}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
  </svg>
)

export const SearchIcon = () => (
  <svg {...common} width={20} height={20}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

export const PlusIcon = () => (
  <svg {...common} width={20} height={20} strokeWidth={2.4}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const MinusIcon = () => (
  <svg {...common} width={20} height={20} strokeWidth={2.4}>
    <path d="M5 12h14" />
  </svg>
)

export const CheckIcon = () => (
  <svg {...common} width={20} height={20} strokeWidth={2.4}>
    <path d="m5 12 5 5 9-10" />
  </svg>
)

export const BackIcon = () => (
  <svg {...common}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
)
