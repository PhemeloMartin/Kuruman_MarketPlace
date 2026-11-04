import { lazy, Suspense } from 'react'
import type { DeliveryMapProps } from './DeliveryMap'

// The map library (Leaflet) is downloaded only when a map is first shown: most pages never need it, and
// many customers are on prepaid mobile data.
const DeliveryMap = lazy(() => import('./DeliveryMap').then((m) => ({ default: m.DeliveryMap })))

export function MapView(props: DeliveryMapProps) {
  return (
    <Suspense fallback={<div className="delivery-map skeleton" style={{ height: props.height ?? 240 }} aria-busy="true" />}>
      <DeliveryMap {...props} />
    </Suspense>
  )
}
