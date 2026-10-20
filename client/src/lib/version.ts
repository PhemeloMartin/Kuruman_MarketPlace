// Values written in by vite.config.ts when the app is built.
declare const __APP_VERSION__: number
declare const __VERSION_TIME__: string

// 1 -> "i", 4 -> "iv", 12 -> "xii": lower-case Roman numerals, built from the largest value down.
export function toRoman(n: number): string {
  const values: [number, string][] = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ]
  let out = ''
  for (const [value, numeral] of values) {
    while (n >= value) {
      out += numeral
      n -= value
    }
  }
  return out
}

// e.g. "version i:20/10/26,09:10"
export const VERSION_LABEL = `version ${toRoman(__APP_VERSION__)}:${__VERSION_TIME__}`
