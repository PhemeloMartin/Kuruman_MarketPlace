// Money travels as whole cents everywhere. We only turn it into "R25.00" at the very
// last moment, for display. Doing sums in cents avoids rounding errors like 0.1 + 0.2.
export function formatRand(cents: number): string {
  const rands = Math.floor(cents / 100)
  const rest = String(cents % 100).padStart(2, '0')
  // Thousands separated by a space, the South African convention: R1 250.00
  return `R${rands.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${rest}`
}

// Turns what a seller types ("25", "25.5", "25.50", "R 25,50") into cents, without floating-point maths.
// Returns null if it isn't a valid amount.
export function parseRandToCents(input: string): number | null {
  const clean = input.replace(/[R\s]/gi, '').replace(',', '.')
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(clean)
  if (!m) return null
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'))
}
