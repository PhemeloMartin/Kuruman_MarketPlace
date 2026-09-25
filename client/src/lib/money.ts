// Money travels as whole cents everywhere. We only turn it into "R25.00" at the very
// last moment, for display. Doing sums in cents avoids rounding errors like 0.1 + 0.2.
export function formatRand(cents: number): string {
  const rands = Math.floor(cents / 100)
  const rest = String(cents % 100).padStart(2, '0')
  // Thousands separated by a space, the South African convention: R1 250.00
  return `R${rands.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${rest}`
}
