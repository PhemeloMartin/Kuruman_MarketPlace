"""Unit tests for service.py: model integrity, abstaining, the confidence threshold, screening, reviews and the
HTTP layer (token, unknown paths, bad input). Uses the real trained models in models/."""

import hashlib
import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer

import service


class ModelIntegrityTest(unittest.TestCase):
    def test_loaded_model_matches_the_hash_in_its_model_card(self):
        path = service.HERE / "models" / service.CARD["artefact"]
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), service.CARD["artefact_sha256"])

    def test_the_categories_are_the_six_trained_labels(self):
        self.assertEqual(
            sorted(map(str, service.CLASSES)),
            ["clothing", "crafts", "fresh-produce", "household", "pantry", "personal-care"],
        )


class PredictTest(unittest.TestCase):
    def test_clear_listing_gets_a_confident_suggestion(self):
        r = service.predict("Fresh spinach bunch", "Green spinach picked this morning from the garden", "en")
        self.assertFalse(r["abstained"])
        self.assertEqual(r["suggestion"], "fresh-produce")
        self.assertGreaterEqual(r["score"], service.THRESHOLD)

    def test_unsupported_language_abstains(self):
        r = service.predict("Pain", "Pain frais", "fr")
        self.assertTrue(r["abstained"])
        self.assertEqual(r["reason"], "unsupported_language")
        self.assertIsNone(r["suggestion"])

    def test_too_little_text_abstains(self):
        r = service.predict("x", "", "en")
        self.assertEqual(r["reason"], "too_little_text")

    def test_unclear_text_abstains_below_the_threshold(self):
        r = service.predict("zzqx", "vvbn qwrt", "en")
        self.assertTrue(r["abstained"])
        self.assertEqual(r["reason"], "low_confidence")
        self.assertLess(r["score"], service.THRESHOLD)

    def test_a_suggestion_is_never_shown_below_the_threshold(self):
        for title in ("Beaded bracelet", "Brown bread", "Dish soap", "Sepinatshe", "abc def"):
            r = service.predict(title, "", "en")
            if not r["abstained"]:
                self.assertGreaterEqual(r["score"], service.THRESHOLD)

    def test_very_long_text_is_cut_not_rejected(self):
        r = service.predict("Spinach", "fresh " * 5000, "en")
        self.assertIn("abstained", r)


class ScreeningTest(unittest.TestCase):
    def test_phone_number_is_flagged_with_its_reason(self):
        r = service.screen("Call me on 082 123 4567")
        self.assertTrue(r["flag"])
        self.assertIn("phone_number", r["reasons"])

    def test_off_platform_payment_request_is_flagged_by_the_model(self):
        r = service.screen("Pay me by eWallet before I deliver, not on the site")
        self.assertTrue(r["flag"])
        self.assertIn("model", r["reasons"])

    def test_an_ordinary_review_is_not_flagged(self):
        r = service.screen("The vetkoek was fresh and the seller was friendly")
        self.assertFalse(r["flag"])
        self.assertEqual(r["reasons"], [])


class ReviewAnalysisTest(unittest.TestCase):
    def test_sentiment_and_themes(self):
        good, bad = service.analyse_reviews(
            ["The vetkoek was fresh and tasty, friendly service", "Cold food and rude staff, too expensive"]
        )
        self.assertEqual(good["sentiment"], "positive")
        self.assertIn("fresh", good["themes"])
        self.assertEqual(bad["sentiment"], "negative")
        self.assertTrue(set(bad["themes"]) <= set(service.REVIEWS["theme_labels"]))


class ForecastWrapperTest(unittest.TestCase):
    def test_short_history_says_not_enough(self):
        r = service.forecast([{"date": "2026-01-01", "units": 3}])
        self.assertFalse(r["enough"])

    def test_four_weeks_give_seven_rounded_days(self):
        hist = [{"date": f"2026-02-{d:02d}", "units": 3} for d in range(1, 29)]
        r = service.forecast(hist)
        self.assertTrue(r["enough"])
        self.assertEqual(len(r["forecast"]), 7)
        self.assertEqual(r["forecast"][0]["date"], "2026-03-01")


class HttpTest(unittest.TestCase):
    """The real request handler on a free local port, with a test token."""

    @classmethod
    def setUpClass(cls):
        cls.saved_token = service.TOKEN
        service.TOKEN = "unit-test-token"
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        service.TOKEN = cls.saved_token

    def request(self, method, path, body=None, token="unit-test-token"):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["X-AI-Token"] = token
        data = body if isinstance(body, (bytes, str)) else json.dumps(body or {})
        conn.request(method, path, body=data if method == "POST" else None, headers=headers)
        res = conn.getresponse()
        payload = json.loads(res.read() or b"{}")
        conn.close()
        return res.status, payload

    def test_health_needs_no_token(self):
        status, body = self.request("GET", "/health", token=None)
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")

    def test_missing_token_is_refused(self):
        status, _ = self.request("POST", "/predict", {"title": "Spinach"}, token=None)
        self.assertEqual(status, 401)

    def test_wrong_token_is_refused(self):
        status, _ = self.request("POST", "/predict", {"title": "Spinach"}, token="guess")
        self.assertEqual(status, 401)

    def test_unknown_path_is_not_found(self):
        self.assertEqual(self.request("POST", "/admin", {})[0], 404)

    def test_malformed_json_is_a_bad_request(self):
        self.assertEqual(self.request("POST", "/predict", "{not json")[0], 400)

    def test_valid_request_returns_a_suggestion_with_model_version(self):
        status, body = self.request("POST", "/predict", {"title": "Beaded bracelet", "description": "Handmade beadwork", "locale": "en"})
        self.assertEqual(status, 200)
        self.assertEqual(body["modelVersion"], service.CARD["model_version"])
        self.assertEqual(body["suggestion"], "crafts")
        self.assertIn("latencyMs", body)


if __name__ == "__main__":
    unittest.main()
