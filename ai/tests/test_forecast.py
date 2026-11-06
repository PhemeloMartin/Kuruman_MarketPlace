"""Unit tests for forecast.py: the payday rule, the feature layout, the minimum history and what the model learns."""

import unittest
from datetime import date, timedelta

import numpy as np

import forecast


def history(days: int, start: date = date(2026, 1, 5), units=lambda d: 2) -> list[tuple[date, int]]:
    return [(start + timedelta(days=i), units(start + timedelta(days=i))) for i in range(days)]


class PaydayTest(unittest.TestCase):
    def test_payday_week_runs_from_the_25th_to_the_3rd(self):
        self.assertEqual(forecast.payday(date(2026, 3, 25)), 1)
        self.assertEqual(forecast.payday(date(2026, 3, 31)), 1)
        self.assertEqual(forecast.payday(date(2026, 4, 1)), 1)
        self.assertEqual(forecast.payday(date(2026, 4, 3)), 1)

    def test_days_outside_payday_week(self):
        self.assertEqual(forecast.payday(date(2026, 4, 4)), 0)
        self.assertEqual(forecast.payday(date(2026, 4, 24)), 0)


class FeaturesTest(unittest.TestCase):
    def test_one_row_per_day_with_weekday_payday_and_trend(self):
        start = date(2026, 1, 5)  # a Monday
        x = forecast.features([start, start + timedelta(days=5), start + timedelta(days=14)], start)
        self.assertEqual(x.shape, (3, 9))  # 7 weekday columns + payday + trend
        self.assertEqual(list(x[0][:7]), [1, 0, 0, 0, 0, 0, 0])  # Monday
        self.assertEqual(list(x[1][:7]), [0, 0, 0, 0, 0, 1, 0])  # Saturday
        self.assertEqual(x[2][8], 2.0)  # two weeks after the start

    def test_exactly_one_weekday_is_set(self):
        start = date(2026, 1, 1)
        x = forecast.features([start + timedelta(days=i) for i in range(14)], start)
        self.assertTrue(np.all(x[:, :7].sum(axis=1) == 1))


class FitPredictTest(unittest.TestCase):
    def test_too_little_history_gives_no_forecast(self):
        self.assertIsNone(forecast.fit_predict(history(forecast.MIN_DAYS - 1)))
        self.assertIsNone(forecast.fit_predict([]))

    def test_forecasts_the_seven_days_after_the_last_sale(self):
        h = history(forecast.MIN_DAYS)
        result = forecast.fit_predict(h)
        self.assertEqual(len(result), 7)
        last = h[-1][0]
        self.assertEqual([d for d, _ in result], [last + timedelta(days=i) for i in range(1, 8)])

    def test_predictions_are_never_negative(self):
        h = history(42, units=lambda d: [0, 1, 0, 3, 0, 5, 0][d.weekday()])
        self.assertTrue(all(u >= 0 for _, u in forecast.fit_predict(h)))

    def test_learns_that_saturdays_are_busier(self):
        h = history(56, units=lambda d: 10 if d.weekday() == 5 else 2)
        result = dict(forecast.fit_predict(h))
        saturday = next(d for d in result if d.weekday() == 5)
        others = [u for d, u in result.items() if d.weekday() != 5]
        self.assertGreater(result[saturday], max(others) * 2)

    def test_a_flat_history_gives_a_flat_forecast_near_its_level(self):
        result = forecast.fit_predict(history(42, units=lambda d: 4))
        for _, u in result:
            self.assertAlmostEqual(u, 4.0, delta=0.5)


class BaselinesTest(unittest.TestCase):
    def test_same_day_last_week_repeats_the_last_seven_days(self):
        h = history(14, units=lambda d: d.weekday())
        self.assertEqual(forecast.same_day_last_week(h), [u for _, u in h[-7:]])

    def test_overall_average(self):
        h = history(4, units=lambda d: [1, 2, 3, 6][d.weekday() % 4])
        self.assertEqual(forecast.overall_average(h, 3), [np.mean([u for _, u in h])] * 3)


if __name__ == "__main__":
    unittest.main()
