# Sales forecast evaluation (forecast-v1)

**Synthetic data** - 40 made-up products x 20 weeks. Backtest: last 6 weeks, each predicted from the weeks before it.

| Method | MAE (units/day) |
|---|---|
| **Poisson regression (shipped)** | **2.5** |
| Same day last week | 3.574 |
| Overall average | 3.301 |

Improvement over the best baseline: 24.3%.

Limits: Synthetic evaluation shows the method can learn such patterns, not that real Kuruman sales follow them. Holidays, weather and events are not modelled. New products have no forecast for 4 weeks.
