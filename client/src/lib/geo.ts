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
              ? 'Location is blocked for this website. Allow it in your browser’s settings (iPhone: Settings > Privacy & Security > Location Services > Safari Websites > While Using; Android Chrome: the icon next to the web address > Permissions), then try again.'
              : 'Your phone couldn’t find where you are. Check that location (GPS) is on, then try again.'
          )
        ),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 }
    )
  })
}

// Directions in the maps app the phone already has: Apple Maps on an iPhone or iPad (it's always there),
// Google Maps everywhere else (Android phones come with it). The server sends a Google Maps link; on an
// iPhone the same destination is opened in Apple Maps instead, so nobody has to install an app.
export function mapsAppLink(googleUrl: string): string {
  const iPhone = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!iPhone) return googleUrl
  const q = new URL(googleUrl).searchParams
  const flag = q.get('travelmode') === 'walking' ? 'w' : 'd'
  return `https://maps.apple.com/?daddr=${encodeURIComponent(q.get('destination') ?? '')}&dirflg=${flag}`
}

// "350 m" or "1.2 km".
export function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.max(10, Math.round(metres / 10) * 10)} m` : `${(metres / 1000).toFixed(1)} km`
}

// How a courier travels, as a map marker.
export const VEHICLE_EMOJI: Record<string, string> = { on_foot: '🚶', bicycle: '🚲', motorbike: '🛵', car: '🚗', bakkie: '🛻' }
