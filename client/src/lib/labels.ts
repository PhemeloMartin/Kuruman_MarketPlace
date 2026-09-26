// Friendly names for codes the server uses.
export const VEHICLE_LABEL: Record<string, string> = {
  on_foot: 'On foot',
  bicycle: 'Bicycle',
  motorbike: 'Motorbike',
  car: 'Car',
  bakkie: 'Bakkie',
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Johannesburg',
  })
}

// Shows 071 234 5678 instead of +27712345678.
export function localPhone(e164: string): string {
  const n = '0' + e164.slice(3)
  return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`
}
