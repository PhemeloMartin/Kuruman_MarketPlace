import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { distanceKm, formatDistance, type Point } from '../lib/geo'
import { MapView } from './MapView'

interface RouteStep {
  text: string
  type: string
  modifier: string | null
  distanceM: number
  at: Point
}

interface Route {
  source: 'roads' | 'straight' // straight = the routing service couldn't be reached
  distanceM: number
  durationS: number
  line: [number, number][]
  steps: RouteStep[]
}

// An arrow for each kind of turn, so the next step can be seen at a glance while driving.
const ARROW: Record<string, string> = {
  left: '⬅️',
  right: '➡️',
  'slight left': '↖️',
  'slight right': '↗️',
  'sharp left': '↙️',
  'sharp right': '↘️',
  straight: '⬆️',
  uturn: '↩️',
}

function arrowFor(step: RouteStep): string {
  if (step.type === 'arrive') return '🏁'
  if (step.type === 'roundabout' || step.type === 'rotary') return '🔄'
  // "Continue onto ..." (only the road's name changes): straight on, even where the road bends.
  if (['depart', 'new name', 'notification'].includes(step.type)) return '⬆️'
  return ARROW[step.modifier ?? ''] ?? '⬆️'
}

// Ask the server for a new route once the courier has moved this far from where the last one started...
const REFRESH_AFTER_M = 50
// ...but not more often than this (the free routing service asks for light use).
const REFRESH_MIN_MS = 10_000
// Closer than this to the pin counts as "arrived" (phone GPS is often 10-30 m out).
const ARRIVED_M = 40

// Turn-by-turn directions to the customer's pin inside the app: the road route on the map, the next turn
// in big letters, and the distance and time left. It works in any phone's browser - no maps app needed.
// The route is worked out again as the courier moves, so the next turn is always the one ahead.
export function InAppDirections({
  jobId,
  me,
  destination,
  customerName,
  vehicleEmoji,
  onClose,
}: {
  jobId: number
  me: Point | null
  destination: Point
  customerName: string
  vehicleEmoji: string
  onClose: () => void
}) {
  const [route, setRoute] = useState<Route | null>(null)
  const [error, setError] = useState<string | null>(null)
  const asked = useRef<{ from: Point; at: number } | null>(null)

  useEffect(() => {
    if (!me) return
    const last = asked.current
    const now = Date.now()
    if (last && (distanceKm(last.from, me) * 1000 < REFRESH_AFTER_M || now - last.at < REFRESH_MIN_MS)) return
    asked.current = { from: me, at: now }
    api<Route>(`/courier/jobs/${jobId}/route?lat=${me.lat}&lng=${me.lng}`)
      .then((r) => {
        setRoute(r)
        setError(null)
      })
      .catch((err) => {
        // No signal or "too soon": try again with the next position. Anything else, say what's wrong.
        if (!(err instanceof ApiError) || err.status === 429) asked.current = null
        else setError(err.message)
      })
  }, [me, jobId])

  const toPin = me ? distanceKm(me, destination) * 1000 : null
  const arrived = toPin !== null && toPin < ARRIVED_M
  // steps[0] is "Start on ..." from where the courier was when the route was worked out; steps[1] is next.
  const next = route && route.steps.length > 1 ? route.steps[1] : null
  const toNext = next && me ? distanceKm(me, next.at) * 1000 : null
  const minutes = route ? Math.max(1, Math.round(route.durationS / 60)) : null

  return (
    <section className="in-app-directions" aria-label={`Directions to ${customerName}`}>
      <div className="nav-next" role="status" aria-live="polite">
        {!me ? (
          <p>📍 Turn on your location to get directions.</p>
        ) : arrived ? (
          <p>
            <span className="nav-arrow" aria-hidden="true">🏁</span>
            <strong>You’ve arrived.</strong> Tap “I’m outside” to tell {customerName}.
          </p>
        ) : next && toNext !== null ? (
          <p>
            <span className="nav-arrow" aria-hidden="true">{arrowFor(next)}</span>
            <strong>{next.text}</strong>
            <span className="nav-in">in {formatDistance(toNext)}</span>
          </p>
        ) : route ? (
          <p>
            <span className="nav-arrow" aria-hidden="true">🧭</span>
            <strong>Head towards the 🏠 pin</strong>
            <span className="nav-in">{formatDistance(toPin ?? route.distanceM)} away</span>
          </p>
        ) : (
          <p>Working out the route…</p>
        )}
      </div>

      {route && !arrived && (
        <p className="nav-summary">
          {formatDistance(route.distanceM)} · about {minutes} min to {customerName}
          {route.source === 'straight' && ' (straight line: road directions aren’t available right now)'}
        </p>
      )}
      {error && <p className="field-error">{error}</p>}

      <MapView
        label={`Map with the route to ${customerName}`}
        centre={destination}
        height={300}
        route={route?.line}
        pins={[
          { id: 'home', ...destination, emoji: '🏠', label: `${customerName}: deliver here` },
          ...(me ? [{ id: 'me', lat: me.lat, lng: me.lng, emoji: vehicleEmoji, label: 'You' }] : []),
        ]}
      />

      {route && route.steps.length > 0 && (
        <details className="nav-steps">
          <summary>All turns ({route.steps.length})</summary>
          <ol>
            {route.steps.map((s, i) => (
              <li key={i}>
                <span aria-hidden="true">{arrowFor(s)}</span> {s.text}
                {s.distanceM > 0 && <span className="fine-print"> · then {formatDistance(s.distanceM)}</span>}
              </li>
            ))}
          </ol>
        </details>
      )}

      <button type="button" className="btn btn-outline btn-block" style={{ marginTop: 8 }} onClick={onClose}>
        Close directions
      </button>
    </section>
  )
}
