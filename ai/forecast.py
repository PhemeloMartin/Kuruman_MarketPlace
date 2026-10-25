"""
The sales-forecast method (used by service.py and evaluated by train_forecast.py).

For one product, from its daily sales on the site (units sold per day), predict the next 7 days.

Model: Poisson regression - the right shape for counts (0, 1, 2, ... units), never negative -
with these features:
  - day of the week (Saturdays and month-end are busy in Kuruman);
  - "payday week": the 25th of the month to the 3rd of the next (SASSA and salary days);
  - a gentle trend (weeks since the start), so a growing shop isn't under-predicted.

It is fitted to each product's OWN history when the seller asks - there is no shared model,
because every shop is different. It needs at least 4 weeks of history; with less, it says so
instead of guessing. Advisory only: the seller decides how much stock to have (spec BR-14
forbids automatic stock or pricing decisions).
"""

from datetime import date, timedelta

import numpy as np
from sklearn.linear_model import PoissonRegressor

MIN_DAYS = 28
# Regularisation: keeps a few weeks of data from over-trusting one odd day. Chosen from 1, 0.5, 0.1,
# 0.03, 0.01 on a SEPARATE synthetic tuning set (seed 7), not on the backtest that is reported (seed 42).
ALPHA = 0.1


def payday(d: date) -> int:
    return int(d.day >= 25 or d.day <= 3)


def features(days: list[date], start: date) -> np.ndarray:
    rows = []
    for d in days:
        weekday = [0] * 7
        weekday[d.weekday()] = 1
        rows.append(weekday + [payday(d), (d - start).days / 7.0])
    return np.array(rows, dtype=float)


def fit_predict(history: list[tuple[date, int]], horizon: int = 7) -> list[tuple[date, float]] | None:
    """history: (day, units sold) for consecutive days, oldest first. None if too little history."""
    if len(history) < MIN_DAYS:
        return None
    start = history[0][0]
    days = [d for d, _ in history]
    y = np.array([u for _, u in history], dtype=float)
    model = PoissonRegressor(alpha=ALPHA, max_iter=1000).fit(features(days, start), y)
    future = [days[-1] + timedelta(days=i) for i in range(1, horizon + 1)]
    return list(zip(future, model.predict(features(future, start)).tolist()))


# Simple baselines the model must beat (train_forecast.py).
def same_day_last_week(history, horizon=7):
    return [history[-7 + (i % 7)][1] for i in range(horizon)]


def overall_average(history, horizon=7):
    avg = float(np.mean([u for _, u in history]))
    return [avg] * horizon
