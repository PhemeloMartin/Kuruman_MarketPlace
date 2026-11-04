import { useEffect, useState } from 'react'
import { api } from './api'
import { distanceKm, type Point } from './geo'

export type Sharing = 'off' | 'starting' | 'on' | 'blocked' | 'unavailable'

// Sends the courier's position to the server while they have a delivery on the go (`active`), so the
// customer can follow it on a map. A website can only do this while it's open: the page keeps the screen
// on while sharing (if the phone allows it) and tells the courier to keep it open.
//
// To keep data use low it sends a new position only when the courier has moved about 30 m or 10 seconds
// have passed - and every 30 seconds while standing still, so the customer sees it's still live.
export function useLiveLocation(active: boolean) {
  const [state, setState] = useState<Sharing>('off')
  const [position, setPosition] = useState<(Point & { accuracy: number }) | null>(null)
  const [wanted, setWanted] = useState(false) // the courier allowed it (now, or on an earlier visit)

  // Allowed on an earlier visit? Then start by itself; blocked? Then say so.
  useEffect(() => {
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((p) => {
        if (p.state === 'granted') setWanted(true)
        if (p.state === 'denied') setState('blocked')
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!active || !wanted || !navigator.geolocation) return
    let last: { at: number; p: Point & { accuracy: number } } | null = null
    const send = (p: Point & { accuracy: number }) => {
      last = { at: Date.now(), p }
      api('/courier/location', { method: 'POST', body: p }).catch(() => {}) // no signal: the next one will do
    }
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }
        setPosition(p)
        setState('on')
        if (!last || Date.now() - last.at > 10_000 || distanceKm(last.p, p) > 0.03) send(p)
      },
      (err) => setState(err.code === err.PERMISSION_DENIED ? 'blocked' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 }
    )
    const heartbeat = setInterval(() => last && send(last.p), 30_000)
    // Keep the screen on, or the phone locks and the browser stops sending.
    let lock: WakeLockSentinel | null = null
    navigator.wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => {})
    return () => {
      navigator.geolocation.clearWatch(watch)
      clearInterval(heartbeat)
      lock?.release().catch(() => {})
    }
  }, [active, wanted])

  // Allowed, but no position from the GPS yet: "starting".
  const shown: Sharing = !active ? 'off' : wanted && state === 'off' ? 'starting' : state
  return { state: shown, position, turnOn: () => setWanted(true) }
}
