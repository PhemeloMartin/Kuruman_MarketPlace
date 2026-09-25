// South African phone numbers are stored in one format: +27 followed by 9 digits.
// People type them many ways ("071 000 0001", "+27 71 000 0001", "27710000001"),
// so we normalise before saving or looking one up. Returns null if it isn't a valid SA number.
export function normaliseSaPhone(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, "");

  let national: string;
  if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  else if (/^\+27\d{9}$/.test(digits)) national = digits.slice(3);
  else if (/^27\d{9}$/.test(digits)) national = digits.slice(2);
  else return null;

  // SA numbers never start with 0 after the country code.
  if (national.startsWith("0")) return null;
  return "+27" + national;
}
