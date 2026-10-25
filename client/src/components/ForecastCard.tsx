import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface ProductForecast {
  productId: number
  name: string
  unitLabel: string
  available: number
  enoughHistory: boolean
  weeksOfHistory: number
  nextWeekTotal: number
  busiestDay: { date: string; units: number } | null
  days: { date: string; units: number }[]
}

const weekday = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-ZA', { weekday: 'long' })

// The sales forecast (Tier 2 AI) on the seller dashboard: plain advice for the next 7 days for the
// shop's best sellers. Advice only - the seller decides how much to make or order.
export function ForecastCard() {
  const [data, setData] = useState<{ available: boolean; modelVersion: string | null; products: ProductForecast[] } | null>(null)
  useEffect(() => {
    api<{ available: boolean; modelVersion: string | null; products: ProductForecast[] }>('/seller/forecast')
      .then(setData)
      .catch(() => setData(null))
  }, [])
  if (!data?.available || data.products.length === 0) return null

  return (
    <section className="seller-section forecast" aria-labelledby="forecast-heading">
      <div className="section-head">
        <h2 id="forecast-heading">Next 7 days</h2>
        <span className="ai-label">AI forecast</span>
      </div>
      <ul className="forecast-list">
        {data.products.map((p) =>
          p.enoughHistory ? (
            <li key={p.productId}>
              <strong>{p.name}</strong>: about <strong>{p.nextWeekTotal}</strong> this week
              {p.busiestDay && (
                <>
                  , busiest on {weekday(p.busiestDay.date)} (about {Math.round(p.busiestDay.units)})
                </>
              )}
              .{' '}
              {p.available < p.nextWeekTotal ? (
                <span className="urgent">You have {p.available} available, so you may run short.</span>
              ) : (
                <span className="product-meta">You have {p.available} available.</span>
              )}
            </li>
          ) : (
            <li key={p.productId}>
              <strong>{p.name}</strong>: <span className="product-meta">a forecast appears after 4 weeks of sales.</span>
            </li>
          ),
        )}
      </ul>
      <p className="fine-print">
        Learned from your own sales on KurumanMarketPlace (weekdays and payday weeks). It’s a guide, not a promise: you
        decide how much to make. Model {data.modelVersion}.
      </p>
    </section>
  )
}
