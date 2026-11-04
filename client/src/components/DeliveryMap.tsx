import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export interface MapPin {
  id: string // e.g. "home", "courier"
  lat: number
  lng: number
  emoji: string // drawn as the marker, e.g. 🏠 or 🛵
  label: string // read out by screen readers and shown on hover
  draggable?: boolean
}

export interface DeliveryMapProps {
  pins: MapPin[]
  centre: { lat: number; lng: number } // shown when there are no pins yet
  label: string // what the map shows, for screen readers
  height?: number
  onPick?: (p: { lat: number; lng: number }) => void // tapping the map (choosing a pin)
  onDrag?: (id: string, p: { lat: number; lng: number }) => void // a draggable pin was moved
}

// A small map with pins, drawn with Leaflet on OpenStreetMap's free map tiles (no API key, no cost; the
// "© OpenStreetMap" credit must stay visible). Leaflet works directly on the page, so the map is created
// once, and the pins are added, moved or removed when `pins` changes.
export function DeliveryMap({ pins, centre, label, height = 240, onPick, onDrag }: DeliveryMapProps) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const markers = useRef(new Map<string, L.Marker>())
  const shownIds = useRef('')
  const userMoved = useRef(false)
  const startAt = useRef(centre) // only the starting view: later changes don't move the map
  // The latest callbacks, so the map's own event handlers (set up once) always call the current ones.
  const handlers = useRef({ onPick, onDrag })
  useEffect(() => {
    handlers.current = { onPick, onDrag }
  })

  useEffect(() => {
    if (!box.current) return
    const m = L.map(box.current, { zoomControl: true }).setView([startAt.current.lat, startAt.current.lng], 13)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => handlers.current.onPick?.({ lat: e.latlng.lat, lng: e.latlng.lng }))
    // Once the person drags the map themselves, it stops re-centring on its own.
    m.on('dragstart', () => {
      userMoved.current = true
    })
    map.current = m
    const all = markers.current
    return () => {
      m.remove()
      map.current = null
      all.clear()
    }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const seen = new Set<string>()
    for (const p of pins) {
      seen.add(p.id)
      let marker = markers.current.get(p.id)
      if (!marker) {
        marker = L.marker([p.lat, p.lng], {
          icon: L.divIcon({ className: 'map-pin', html: `<span>${p.emoji}</span>`, iconSize: [38, 38], iconAnchor: [19, 36] }),
          title: p.label,
          alt: p.label,
          draggable: Boolean(p.draggable),
          keyboard: true,
        }).addTo(m)
        const id = p.id
        marker.on('dragend', (e) => {
          const at = (e.target as L.Marker).getLatLng()
          handlers.current.onDrag?.(id, { lat: at.lat, lng: at.lng })
        })
        markers.current.set(p.id, marker)
      } else {
        marker.setLatLng([p.lat, p.lng])
      }
    }
    for (const [id, marker] of markers.current) {
      if (!seen.has(id)) {
        marker.remove()
        markers.current.delete(id)
      }
    }

    // Re-centre when a pin appears or disappears, or when one moves off the screen (unless the person is
    // looking around the map themselves).
    const ids = pins.map((p) => p.id).join(',')
    const offScreen = pins.some((p) => !m.getBounds().contains([p.lat, p.lng]))
    if (pins.length > 0 && (ids !== shownIds.current || (offScreen && !userMoved.current))) {
      if (pins.length === 1) m.setView([pins[0].lat, pins[0].lng], Math.max(m.getZoom(), 16))
      else m.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 17 })
    }
    shownIds.current = ids
  }, [pins])

  return <div ref={box} className="delivery-map" style={{ height }} role="region" aria-label={label} />
}
