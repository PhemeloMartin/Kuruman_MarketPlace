import { useState } from 'react'
import { MapView } from './MapView'
import { currentPosition, distanceKm, type Point } from '../lib/geo'

interface Area {
  serviceCentre: Point
  serviceRadiusKm: number
}

// "Help the courier find you": an optional map pin next to the written address. Many homes here have no
// street number, so a pin (from the phone's GPS, or a tap on the map) gets the courier to the right gate.
export function LocationPicker({ value, onChange, area, error }: { value: Point | null; onChange: (p: Point | null) => void; area: Area; error?: string }) {
  const [open, setOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Said straight away, so nobody finds out only when sending the order.
  const outside = value !== null && distanceKm(value, area.serviceCentre) > area.serviceRadiusKm

  async function useMyLocation() {
    setOpen(true)
    setLocating(true)
    setMessage(null)
    try {
      const p = await currentPosition()
      onChange({ lat: p.lat, lng: p.lng })
      setMessage(
        p.accuracy > 100
          ? `Your phone is only sure to about ${p.accuracy} m. Please drag the pin to your gate.`
          : 'Pin placed where you are. Drag it to your gate if it’s not quite right.'
      )
    } catch (err) {
      setMessage(`${(err as Error).message} Or tap the map where we should deliver.`)
    } finally {
      setLocating(false)
    }
  }

  return (
    <div className="location-picker" data-invalid={Boolean(error) || outside}>
      <strong>📍 Help the courier find you</strong>
      <p className="hint" style={{ marginTop: 2 }}>
        Optional, but it helps a lot when there’s no street number. Only the courier (or the shop delivering)
        sees it, and only while delivering.
      </p>
      <div className="btn-row">
        <button type="button" className="btn btn-outline" onClick={useMyLocation} disabled={locating}>
          {locating ? 'Finding you…' : value ? 'Use my location again' : 'Use my location'}
        </button>
        {!open && !value ? (
          <button type="button" className="btn btn-outline" onClick={() => setOpen(true)}>
            Choose on the map
          </button>
        ) : (
          value && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                onChange(null)
                setMessage(null)
              }}
            >
              Remove pin
            </button>
          )
        )}
      </div>
      {(open || value) && (
        <>
          <MapView
            label="Map for choosing where to deliver. Tap the map to place the pin, or drag the pin."
            centre={area.serviceCentre}
            height={220}
            pins={value ? [{ id: 'home', ...value, emoji: '🏠', label: 'Deliver here', draggable: true }] : []}
            onPick={(p) => {
              onChange(p)
              setMessage(null)
            }}
            onDrag={(_id, p) => onChange(p)}
          />
          {!value && !locating && <p className="fine-print">Tap the map where we should deliver.</p>}
        </>
      )}
      {message && <p className="fine-print">{message}</p>}
      {outside && !error && (
        <p className="field-error">That pin is outside the area we deliver to. Move it to the delivery place, or remove it.</p>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  )
}
