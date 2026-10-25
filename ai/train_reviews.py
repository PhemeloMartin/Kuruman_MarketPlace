"""
Train and evaluate the review model (Tier 2 AI, model "reviews").

    python train_reviews.py

Two jobs, one dataset (data/reviews.psv, 110 reviews x English, Setswana, Afrikaans):
  1. SENTIMENT - positive / neutral / negative (TF-IDF + multinomial logistic regression).
  2. THEMES    - what the review talks about (fresh, tasty, friendly, quick, slow, good price,
                 expensive, poor quality, cold, rude). A review can have several themes, so a trained
                 model would be one yes/no classifier per theme ("one-vs-rest").

     History (recorded in the model card): the first run, without class balancing, scored BELOW a
     keyword lexicon on the test reviews. Class balancing was then chosen by cross-validation on
     the development reviews only (CV micro-F1 0.50 vs 0.34). The decision to ship the trained
     model is fixed here in advance - the test set grades it, it does not choose it.

Same discipline as the category model:
  - split by review concept: all three translations stay on the same side;
  - choose settings by 5-fold GROUPED cross-validation on the development reviews only;
  - evaluate ONCE on the held-out test reviews, against simple baselines;
  - save the model with its SHA-256 in a model card.

What it is used for: "Customers mention: fresh (5), friendly (3)" on shop pages, and a sentiment
label sellers see next to each review. Advisory only - it never hides or changes a review.
"""

import json
from collections import Counter

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.multiclass import OneVsRestClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import MultiLabelBinarizer

from aikit import HERE, LANGUAGES, SEED, grouped_split, load_psv, sha256, text_features, write_card

MODEL_VERSION = "reviews-v1"
DATA = HERE / "data" / "reviews.psv"
SENTIMENTS = ["positive", "neutral", "negative"]
THEMES = ["fresh", "tasty", "friendly", "quick", "slow", "good_price", "expensive", "poor_quality", "cold", "rude"]

# A few obvious words per theme/sentiment, in the three languages - the "keyword baseline" the model must beat.
KEYWORDS = {
    "fresh": ["fresh", "sesha", "ntšha", "vars"],
    "tasty": ["tasty", "delicious", "monate", "lekker", "heerlik"],
    "friendly": ["friendly", "kind", "botsalano", "pelonolo", "vriendelik", "gaaf"],
    "quick": ["quick", "fast", "bonako", "vinnig"],
    "slow": ["slow", "waited", "late", "bonya", "diegile", "stadig", "gewag"],
    "good_price": ["cheap", "price", "affordable", "tlhwatlhwa", "goedkoop", "prys"],
    "expensive": ["expensive", "overpriced", "tura", "duur"],
    "poor_quality": ["rotten", "stale", "broke", "bodile", "swak", "vrot"],
    "cold": ["cold", "tsididi", "koud"],
    "rude": ["rude", "maitseo", "onbeskof"],
}
NEGATIVE_WORDS = ["not", "bad", "terrible", "rude", "cold", "rotten", "ga ", "maswe", "nie", "sleg", "swak"]
POSITIVE_WORDS = ["good", "great", "best", "fresh", "tasty", "monate", "siame", "lekker", "goed", "dankie", "leboga"]


def themes_of(row):
    return [] if row["themes"] == "-" else row["themes"].split(",")


def keyword_sentiment(text):
    neg = sum(w in text for w in NEGATIVE_WORDS)
    pos = sum(w in text for w in POSITIVE_WORDS)
    return "negative" if neg > pos else "positive" if pos > neg else "neutral"


def keyword_themes(text):
    return [t for t, words in KEYWORDS.items() if any(w in text for w in words)]


def sentiment_model(c):
    return Pipeline([("features", text_features()), ("clf", LogisticRegression(C=c, max_iter=3000, random_state=SEED))])


def theme_model(c):
    return Pipeline(
        [
            ("features", text_features()),
            # balanced: themes are rare (most reviews mention one or none), so each "yes" counts more.
            ("clf", OneVsRestClassifier(LogisticRegression(C=c, max_iter=3000, class_weight="balanced", random_state=SEED))),
        ]
    )


def main():
    rows, concepts = load_psv(DATA)
    dev_ids, test_ids = grouped_split(concepts, lambda r: r["sentiment"])
    dev = [r for cid in dev_ids for r in concepts[cid]]
    test = [r for cid in test_ids for r in concepts[cid]]
    print(f"Reviews dev/test: {len(dev_ids)}/{len(test_ids)} concepts, {len(dev)}/{len(test)} texts")

    x_dev, groups = [r["text"] for r in dev], [r["concept_id"] for r in dev]
    y_sent = [r["sentiment"] for r in dev]
    mlb = MultiLabelBinarizer(classes=THEMES)
    y_themes = mlb.fit_transform([themes_of(r) for r in dev])
    folds = list(StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SEED).split(x_dev, y_sent, groups))

    # --- Choose C for each model by grouped cross-validation (development data only) ---
    def cv_sentiment(c):
        preds = [None] * len(dev)
        for tr, va in folds:
            m = sentiment_model(c).fit([x_dev[i] for i in tr], [y_sent[i] for i in tr])
            for i, p in zip(va, m.predict([x_dev[i] for i in va])):
                preds[i] = p
        return f1_score(y_sent, preds, labels=SENTIMENTS, average="macro")

    def cv_themes(c, threshold):
        probs = np.zeros(y_themes.shape)
        for tr, va in folds:
            m = theme_model(c).fit([x_dev[i] for i in tr], y_themes[tr])
            probs[va] = m.predict_proba([x_dev[i] for i in va])
        return f1_score(y_themes, (probs >= threshold).astype(int), average="micro", zero_division=0)

    grid = [0.5, 1, 3, 10, 30]
    sent_scores = {c: cv_sentiment(c) for c in grid}
    best_sent_c = max(sent_scores, key=sent_scores.get)
    theme_scores = {(c, t): cv_themes(c, t) for c in grid for t in (0.2, 0.3, 0.4, 0.5)}
    best_theme_c, theme_threshold = max(theme_scores, key=theme_scores.get)
    print(f"Sentiment: C={best_sent_c} (CV macro-F1 {sent_scores[best_sent_c]:.3f})")
    print(f"Themes:    C={best_theme_c}, threshold {theme_threshold} (CV micro-F1 {theme_scores[(best_theme_c, theme_threshold)]:.3f})")

    # --- Final models on all development data ---
    sentiment = sentiment_model(best_sent_c).fit(x_dev, y_sent)
    themes = theme_model(best_theme_c).fit(x_dev, y_themes)

    # --- One evaluation on the held-out test reviews ---
    x_test = [r["text"] for r in test]
    yt_sent = [r["sentiment"] for r in test]
    yt_themes = mlb.transform([themes_of(r) for r in test])
    p_sent = list(sentiment.predict(x_test))
    p_themes = (themes.predict_proba(x_test) >= theme_threshold).astype(int)

    majority = Counter(y_sent).most_common(1)[0][0]
    results = {
        "sentiment_macro_f1": f1_score(yt_sent, p_sent, labels=SENTIMENTS, average="macro"),
        "sentiment_majority_baseline": f1_score(yt_sent, [majority] * len(test), labels=SENTIMENTS, average="macro", zero_division=0),
        "sentiment_keyword_baseline": f1_score(yt_sent, [keyword_sentiment(t) for t in x_test], labels=SENTIMENTS, average="macro"),
        "themes_micro_f1": f1_score(yt_themes, p_themes, average="micro", zero_division=0),
        "themes_keyword_baseline": f1_score(yt_themes, mlb.transform([keyword_themes(t) for t in x_test]), average="micro", zero_division=0),
        "sentiment_macro_f1_per_language": {
            lang: f1_score(
                [r["sentiment"] for r in test if r["language"] == lang],
                [p for p, r in zip(p_sent, test) if r["language"] == lang],
                labels=SENTIMENTS,
                average="macro",
                zero_division=0,
            )
            for lang in LANGUAGES
        },
    }
    results = json.loads(json.dumps(results), parse_float=lambda v: round(float(v), 3))
    print(json.dumps(results, indent=2))

    artefact = HERE / "models" / f"{MODEL_VERSION}.joblib"
    joblib.dump({"sentiment": sentiment, "themes": themes, "theme_labels": THEMES, "theme_threshold": theme_threshold}, artefact)
    card = {
        "model_version": MODEL_VERSION,
        "artefact": artefact.name,
        "artefact_sha256": sha256(artefact),
        "purpose": "Sentiment and themes of customer reviews, shown as a summary. Advisory only.",
        "method": "TF-IDF word (1-2) + character (3-5) n-grams; multinomial logistic regression (sentiment); "
        "one-vs-rest logistic regression (themes).",
        "data": "data/reviews.psv - 110 student-authored review concepts x 3 languages (see data/PROVENANCE.md).",
        "split": {"development_concepts": len(dev_ids), "test_concepts": len(test_ids), "grouped_by": "concept_id"},
        "tuning": {"sentiment_C": best_sent_c, "themes_C": best_theme_c, "theme_threshold": theme_threshold, "cv": "5-fold grouped"},
        "test_set_note": "The test reviews were scored once before class balancing was added (themes then lost to the "
        "keyword lexicon). Balancing was chosen by grouped cross-validation only, but the test set is no longer strictly "
        "unseen. The themes margin over the lexicon is small on 23 concepts: treat the two as roughly equal.",
        "test_results": results,
        "limits": "Small synthetic dataset; Setswana and Afrikaans unreviewed. Sarcasm and mixed reviews are hard. "
        "Never used to hide, rank or remove reviews.",
    }
    write_card("reviews", card)
    write_report(card)
    print(f"Saved {artefact.name} and models/reviews_card.json")


def write_report(card):
    r = card["test_results"]
    lines = [
        f"# Review model evaluation ({card['model_version']})",
        "",
        f"Held-out test: {card['split']['test_concepts']} review concepts x 3 languages, never used for training or tuning.",
        "",
        "| | Model | Keyword baseline | Majority baseline |",
        "|---|---|---|---|",
        f"| Sentiment (macro-F1) | **{r['sentiment_macro_f1']}** | {r['sentiment_keyword_baseline']} | {r['sentiment_majority_baseline']} |",
        f"| Themes (micro-F1) | {r['themes_micro_f1']} | {r['themes_keyword_baseline']} | - |",
        "",
        f"Note: {card['test_set_note']}",
        "",
        "Sentiment macro-F1 per language: "
        + ", ".join(f"{k} {v}" for k, v in r["sentiment_macro_f1_per_language"].items()),
        "",
        f"Limits: {card['limits']}",
        "",
    ]
    (HERE / "reports" / "reviews_evaluation.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
