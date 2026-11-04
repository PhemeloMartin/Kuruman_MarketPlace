export interface Point {
  lat: number
  lng: number
}

// Straight-line distance in km (the haversine formula; the server uses the same one in lib/geo.ts).
export function distanceKm(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

// The phone's position, once, as a promise. Fails with a sentence the person can act on.
export function currentPosition(): Promise<Point & { accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser can’t share your location.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? 'Location is blocked for this site. Allow it with the lock icon next to the web address, then try again.'
              : 'Your phone couldn’t find where you are. Check that location (GPS) is on, then try again.'
          )
        ),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 }
    )
  })
}

// How a courier travels, as a map marker.
export const VEHICLE_EMOJI: Record<string, string> = { on_foot: '🚶', bicycle: '🚲', motorbike: '🛵', car: '🚗', bakkie: '🛻' }
