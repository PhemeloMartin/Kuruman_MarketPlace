"""
Evaluate the sales-forecast method (forecast.py) - Tier 2 AI, model "forecast".

    python train_forecast.py

There is no real sales history yet, so the method is tested on SYNTHETIC histories with known
patterns (clearly labelled as such in the report and the model card): 40 made-up products, 20 weeks
each, with a weekday pattern, busier payday weeks, a slow trend and random day-to-day noise
(Poisson). The patterns differ per product, like real shops.

Backtest ("rolling origin"): for each of the last 6 weeks, fit on everything before it, predict
that week, and compare with what "happened". Measured by MAE (average units off per day) against
two baselines: "same day last week" and "overall average". Nothing here is tuned on the weeks it is
scored on.

With real data later, the same script can be pointed at real daily sales instead.
"""

import json
from datetime import date, timedelta

import numpy as np

from aikit import HERE, SEED, write_card
from forecast import ALPHA, MIN_DAYS, fit_predict, overall_average, same_day_last_week

MODEL_VERSION = "forecast-v1"
PRODUCTS = 40
WEEKS = 20
TEST_WEEKS = 6
START = date(2026, 3, 2)  # a Monday


def synthetic_history(rng: np.random.Generator):
    """One made-up product: base level, weekday shape, payday boost, trend, Poisson noise."""
    base = rng.uniform(1.5, 12)
    weekday_shape = np.array([0.8, 0.8, 0.9, 0.9, 1.2, 1.6, 0.7]) * rng.uniform(0.85, 1.15, 7)
    payday_boost = rng.uniform(1.0, 1.6)
    trend = rng.uniform(-0.01, 0.03)  # per week
    history = []
    for i in range(WEEKS * 7):
        d = START + timedelta(days=i)
        pay = d.day >= 25 or d.day <= 3
        mean = base * weekday_shape[d.weekday()] * (payday_boost if pay else 1.0) * (1 + trend * i / 7)
        history.append((d, int(rng.poisson(max(mean, 0.05)))))
    return history


def main():
    rng = np.random.default_rng(SEED)
    errors = {"model": [], "same_day_last_week": [], "overall_average": []}
    for _ in range(PRODUCTS):
        history = synthetic_history(rng)
        for w in range(WEEKS - TEST_WEEKS, WEEKS):
            past, actual = history[: w * 7], [u for _, u in history[w * 7 : w * 7 + 7]]
            pred = [p for _, p in fit_predict(past)]
            errors["model"] += [abs(p - a) for p, a in zip(pred, actual)]
            errors["same_day_last_week"] += [abs(p - a) for p, a in zip(same_day_last_week(past), actual)]
            errors["overall_average"] += [abs(p - a) for p, a in zip(overall_average(past), actual)]

    mae = {k: round(float(np.mean(v)), 3) for k, v in errors.items()}
    improvement = round(1 - mae["model"] / min(mae["same_day_last_week"], mae["overall_average"]), 3)
    print(json.dumps({"mae_units_per_day": mae, "improvement_over_best_baseline": improvement}, indent=2))

    card = {
        "model_version": MODEL_VERSION,
        "artefact": None,
        "purpose": "Predict a product's sales for the next 7 days from its own sales history, as advice for the seller.",
        "method": f"Poisson regression (alpha {ALPHA}) on weekday, payday week (25th-3rd) and trend; fitted per product "
        f"on request; needs at least {MIN_DAYS} days of history.",
        "evaluation_data": f"SYNTHETIC: {PRODUCTS} made-up products x {WEEKS} weeks with known weekday, payday, trend and "
        "Poisson noise. Not real sales.",
        "backtest": f"Rolling origin over the last {TEST_WEEKS} weeks of each product; MAE in units per day.",
        "test_results": {"mae_units_per_day": mae, "improvement_over_best_baseline": improvement},
        "human_in_the_loop": "Advice only: the seller decides stock and prices (spec BR-14 forbids automated stock or "
        "pricing decisions).",
        "limits": "Synthetic evaluation shows the method can learn such patterns, not that real Kuruman sales follow "
        "them. Holidays, weather and events are not modelled. New products have no forecast for 4 weeks.",
    }
    write_card("forecast", card)
    (HERE / "reports" / "forecast_evaluation.md").write_text(
        "\n".join(
            [
                f"# Sales forecast evaluation ({MODEL_VERSION})",
                "",
                f"**Synthetic data** - {PRODUCTS} made-up products x {WEEKS} weeks. Backtest: last {TEST_WEEKS} weeks, "
                "each predicted from the weeks before it.",
                "",
                "| Method | MAE (units/day) |",
                "|---|---|",
                f"| **Poisson regression (shipped)** | **{mae['model']}** |",
                f"| Same day last week | {mae['same_day_last_week']} |",
                f"| Overall average | {mae['overall_average']} |",
                "",
                f"Improvement over the best baseline: {round(improvement * 100, 1)}%.",
                "",
                f"Limits: {card['limits']}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    print("Saved models/forecast_card.json and reports/forecast_evaluation.md")


if __name__ == "__main__":
    main()
