"""
Private prediction service for KurumanMarketPlace's own AI models (spec 8.2 "Deployment").

  POST /predict          listing category (category-v2)        - train.py
  POST /reviews/analyse  review sentiment and themes (reviews-v1) - train_reviews.py
  POST /screen           off-platform / scam screening (screening-v1) - train_screening.py
  POST /forecast         7-day sales forecast (forecast-v1, fitted per request) - forecast.py

    python service.py            (listens on 127.0.0.1:5001)

- Only the Express API calls it, with a shared secret in the X-AI-Token header.
- Loads the model only if its SHA-256 matches models/model_card.json (a tampered or
  swapped file is refused).
- Never logs the listing text (spec 8.2 "Retention").
- Abstains instead of guessing: below the threshold, or for an unsupported language,
  it returns no suggestion and the seller picks the category by hand.
"""

import hashlib
import hmac
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import re
from datetime import date

import joblib

from forecast import fit_predict

HERE = Path(__file__).parent
CARD = json.loads((HERE / "models" / "model_card.json").read_text(encoding="utf-8"))
def token_from_server_env() -> str:
    """Reads AI_SERVICE_TOKEN from server/.env so the secret lives in one place."""
    env = HERE.parent / "server" / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("AI_SERVICE_TOKEN="):
                return line.split("=", 1)[1].strip()
    return ""


TOKEN = os.environ.get("AI_SERVICE_TOKEN") or token_from_server_env()
HOST = os.environ.get("AI_SERVICE_HOST", "127.0.0.1")
# Hosting platforms such as Render tell the app which port to use in PORT.
PORT = int(os.environ.get("AI_SERVICE_PORT") or os.environ.get("PORT") or "5001")
SUPPORTED_LOCALES = {"en", "tn", "af"}
MAX_TEXT = 1000


def load_verified_model():
    path = HERE / "models" / CARD["artefact"]
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != CARD["artefact_sha256"]:
        sys.exit(f"Refusing to start: {path.name} does not match the hash in model_card.json.")
    return joblib.load(path)


BUNDLE = load_verified_model()
PIPELINE = BUNDLE["pipeline"]
CLASSES = list(PIPELINE.classes_)
THRESHOLD = CARD["threshold"]


def load_optional(name: str):
    """The Tier 2 models: loaded only if present AND their hash matches the card; otherwise that endpoint is off."""
    card_path = HERE / "models" / f"{name}_card.json"
    if not card_path.exists():
        return None, None
    card = json.loads(card_path.read_text(encoding="utf-8"))
    path = HERE / "models" / card["artefact"]
    if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != card["artefact_sha256"]:
        print(f"{name}: model file missing or hash mismatch - endpoint switched off")
        return card, None
    return card, joblib.load(path)


REVIEWS_CARD, REVIEWS = load_optional("reviews")
SCREEN_CARD, SCREEN = load_optional("screening")
FORECAST_CARD = json.loads((HERE / "models" / "forecast_card.json").read_text(encoding="utf-8"))


def analyse_reviews(texts: list[str]) -> list[dict]:
    clean = [str(t)[:MAX_TEXT].lower() for t in texts]
    sentiments = REVIEWS["sentiment"].predict(clean)
    theme_probs = REVIEWS["themes"].predict_proba(clean)
    out = []
    for s, probs in zip(sentiments, theme_probs):
        themes = [label for label, p in zip(REVIEWS["theme_labels"], probs) if p >= REVIEWS["theme_threshold"]]
        out.append({"sentiment": str(s), "themes": themes})
    return out


def screen(text: str) -> dict:
    t = str(text)[:MAX_TEXT].lower()
    score = float(SCREEN["pipeline"].predict_proba([t])[0][1])
    reasons = []
    if re.search(SCREEN["phone_pattern"], t):
        reasons.append("phone_number")
    if score >= SCREEN["threshold"]:
        reasons.append("model")
    return {"flag": bool(reasons), "score": round(score, 3), "reasons": reasons, "modelVersion": SCREEN_CARD["model_version"]}


def forecast(history: list[dict]) -> dict:
    days = [(date.fromisoformat(h["date"]), int(h["units"])) for h in history][-140:]
    result = fit_predict(days)
    if result is None:
        return {"enough": False, "modelVersion": FORECAST_CARD["model_version"]}
    return {
        "enough": True,
        "modelVersion": FORECAST_CARD["model_version"],
        "forecast": [{"date": d.isoformat(), "units": round(u, 1)} for d, u in result],
    }


def predict(title: str, description: str, locale: str) -> dict:
    base = {"modelVersion": CARD["model_version"], "threshold": THRESHOLD}
    if locale not in SUPPORTED_LOCALES:
        return {**base, "suggestion": None, "score": None, "abstained": True, "reason": "unsupported_language"}
    text = f"{title}. {description}".strip().lower()[:MAX_TEXT]
    if len(text) < 3:
        return {**base, "suggestion": None, "score": None, "abstained": True, "reason": "too_little_text"}

    proba = PIPELINE.predict_proba([text])[0]
    best = int(proba.argmax())
    score = float(proba[best])
    if score < THRESHOLD:
        return {**base, "suggestion": None, "score": round(score, 3), "abstained": True, "reason": "low_confidence"}
    return {**base, "suggestion": CLASSES[best], "score": round(score, 3), "abstained": False, "reason": None}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {
                "status": "ok",
                "modelVersion": CARD["model_version"],
                "models": {"reviews": REVIEWS is not None, "screening": SCREEN is not None, "forecast": True},
            })
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path not in ("/predict", "/reviews/analyse", "/screen", "/forecast"):
            return self._send(404, {"error": "not found"})
        # compare_digest takes the same time whether the first or last character is wrong,
        # so the token can't be guessed character by character from response times.
        if not TOKEN or not hmac.compare_digest(self.headers.get("X-AI-Token", ""), TOKEN):
            return self._send(401, {"error": "unauthorised"})
        try:
            length = min(int(self.headers.get("Content-Length", 0)), 100_000)
            body = json.loads(self.rfile.read(length) or b"{}")
            started = time.perf_counter()
            if self.path == "/reviews/analyse":
                if REVIEWS is None:
                    return self._send(503, {"error": "model unavailable"})
                return self._send(200, {"results": analyse_reviews(list(body.get("texts", []))[:200]), "modelVersion": REVIEWS_CARD["model_version"]})
            if self.path == "/screen":
                if SCREEN is None:
                    return self._send(503, {"error": "model unavailable"})
                return self._send(200, screen(body.get("text", "")))
            if self.path == "/forecast":
                result = forecast(list(body.get("history", [])))
                result["latencyMs"] = round((time.perf_counter() - started) * 1000, 2)
                return self._send(200, result)
            title = str(body.get("title", ""))[:200]
            description = str(body.get("description", ""))[:MAX_TEXT]
            locale = str(body.get("locale", "en"))
        except (ValueError, KeyError, TypeError, json.JSONDecodeError):
            return self._send(400, {"error": "bad request"})
        started = time.perf_counter()
        result = predict(title, description, locale)
        result["latencyMs"] = round((time.perf_counter() - started) * 1000, 2)
        self._send(200, result)

    # Log the request line only - never the listing text.
    def log_message(self, fmt, *args):
        sys.stderr.write(f"{self.address_string()} {self.command} {self.path} -> {args[1] if len(args) > 1 else ''}\n")


if __name__ == "__main__":
    if not TOKEN:
        sys.exit("Set AI_SERVICE_TOKEN (the same value as in server/.env) before starting.")
    print(f"Category model {CARD['model_version']} verified (sha256 {CARD['artefact_sha256'][:12]}...), threshold {THRESHOLD}")
    print(f"Listening on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
