"""
Train and evaluate the off-platform / scam screening model (Tier 2 AI, model "screening").

    python train_screening.py

What it does: reads a product description, shop "about" text or review, and says whether a
person in support should look at it - e.g. "pay me on eWallet first", "WhatsApp me to buy",
"send a deposit to my account". It protects buyers (money sent outside the site has no refund
or handover code) and the marketplace itself (sales moved to WhatsApp).

It NEVER blocks or deletes anything: it only adds an item to support's "Flagged for review" list.

Method: TF-IDF + logistic regression, plus one rule - a South African phone number in the text
is always flagged (posting a number is the usual first step to taking a sale off the site).

The threshold is chosen for HIGH RECALL (catch at least 90% of suspicious texts in
cross-validation), because a wrong flag costs support a few seconds while a missed scam costs a
customer money. Data: data/screening.psv - 60 concepts x 3 languages, including "hard" normal
texts that mention WhatsApp or cash innocently.
"""

import json
import re

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, precision_score, recall_score
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import Pipeline

from aikit import HERE, LANGUAGES, SEED, grouped_split, load_psv, sha256, text_features, write_card

MODEL_VERSION = "screening-v1"
DATA = HERE / "data" / "screening.psv"
TARGET_RECALL = 0.90

# The rule: something that looks like a South African phone number (0xx xxx xxxx or +27...).
PHONE = re.compile(r"(\+27|\b0)[6-8]\d[\s-]?\d{3}[\s-]?\d{4}\b")

# Keyword baseline the model must beat.
SUSPICIOUS = ["ewallet", "deposit", "bank", "transfer", "outside", "directly", "upfront", "pin", "instant money", "cash send", "pay first", "duela pele", "betaal eers"]


def keyword_flag(text):
    return int(bool(PHONE.search(text)) or any(w in text for w in SUSPICIOUS))


def model(c):
    return Pipeline([("features", text_features()), ("clf", LogisticRegression(C=c, max_iter=3000, class_weight="balanced", random_state=SEED))])


def main():
    rows, concepts = load_psv(DATA)
    dev_ids, test_ids = grouped_split(concepts, lambda r: r["label"])
    dev = [r for cid in dev_ids for r in concepts[cid]]
    test = [r for cid in test_ids for r in concepts[cid]]
    print(f"Screening dev/test: {len(dev_ids)}/{len(test_ids)} concepts, {len(dev)}/{len(test)} texts")

    x_dev = [r["text"] for r in dev]
    y_dev = np.array([int(r["label"] == "flag") for r in dev])
    groups = [r["concept_id"] for r in dev]
    folds = list(StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SEED).split(x_dev, y_dev, groups))

    def out_of_fold(c):
        p = np.zeros(len(dev))
        for tr, va in folds:
            m = model(c).fit([x_dev[i] for i in tr], y_dev[tr])
            p[va] = m.predict_proba([x_dev[i] for i in va])[:, 1]
        return p

    grid = [0.3, 1, 3, 10, 30]
    oof = {c: out_of_fold(c) for c in grid}
    best_c = max(grid, key=lambda c: f1_score(y_dev, (oof[c] >= 0.5).astype(int)))
    # Highest threshold that still catches >= 90% of suspicious texts (fewest false alarms at that recall).
    threshold = 0.5
    for t in np.round(np.arange(0.9, 0.04, -0.01), 2):
        if recall_score(y_dev, (oof[best_c] >= t).astype(int)) >= TARGET_RECALL:
            threshold = float(t)
            break
    print(f"C={best_c}, threshold {threshold}")

    final = model(best_c).fit(x_dev, y_dev)

    x_test = [r["text"] for r in test]
    y_test = np.array([int(r["label"] == "flag") for r in test])
    p_model = (final.predict_proba(x_test)[:, 1] >= threshold).astype(int)
    p_combined = np.maximum(p_model, [int(bool(PHONE.search(t))) for t in x_test])
    p_keyword = np.array([keyword_flag(t) for t in x_test])

    def scores(pred):
        return {
            "precision": precision_score(y_test, pred, zero_division=0),
            "recall": recall_score(y_test, pred, zero_division=0),
            "f1": f1_score(y_test, pred, zero_division=0),
        }

    results = {
        "model_plus_phone_rule": scores(p_combined),
        "model_only": scores(p_model),
        "keyword_baseline": scores(p_keyword),
        "recall_per_language": {
            lang: recall_score(
                [y for y, r in zip(y_test, test) if r["language"] == lang],
                [p for p, r in zip(p_combined, test) if r["language"] == lang],
                zero_division=0,
            )
            for lang in LANGUAGES
        },
    }
    results = json.loads(json.dumps(results), parse_float=lambda v: round(float(v), 3))
    print(json.dumps(results, indent=2))

    artefact = HERE / "models" / f"{MODEL_VERSION}.joblib"
    joblib.dump({"pipeline": final, "threshold": threshold, "phone_pattern": PHONE.pattern}, artefact)
    card = {
        "model_version": MODEL_VERSION,
        "artefact": artefact.name,
        "artefact_sha256": sha256(artefact),
        "purpose": "Flag texts that try to move payment or sales off the site, or look like scams, for a support person to review.",
        "method": "TF-IDF word + character n-grams; logistic regression (balanced); OR a South African phone-number rule.",
        "data": "data/screening.psv - 60 student-authored concepts x 3 languages (30 suspicious, 30 normal incl. hard negatives).",
        "split": {"development_concepts": len(dev_ids), "test_concepts": len(test_ids), "grouped_by": "concept_id"},
        "tuning": {"C": best_c, "threshold": threshold, "rule": f"recall >= {TARGET_RECALL} in 5-fold grouped CV"},
        "test_results": results,
        "human_in_the_loop": "Never blocks, hides or deletes. A flag only puts the item on support's review list; "
        "support decides, and the decision is in the audit log.",
        "limits": "Very small synthetic dataset; scammers change wording. Unreviewed Setswana/Afrikaans. "
        "Expect false alarms on honest texts that mention payment.",
    }
    write_card("screening", card)
    r = results
    (HERE / "reports" / "screening_evaluation.md").write_text(
        "\n".join(
            [
                f"# Screening model evaluation ({MODEL_VERSION})",
                "",
                f"Held-out test: {len(test_ids)} concepts x 3 languages. Threshold {threshold} chosen for recall >= {TARGET_RECALL} in cross-validation.",
                "",
                "| | Precision | Recall | F1 |",
                "|---|---|---|---|",
                f"| **Model + phone rule (shipped)** | {r['model_plus_phone_rule']['precision']} | {r['model_plus_phone_rule']['recall']} | {r['model_plus_phone_rule']['f1']} |",
                f"| Model only | {r['model_only']['precision']} | {r['model_only']['recall']} | {r['model_only']['f1']} |",
                f"| Keyword baseline | {r['keyword_baseline']['precision']} | {r['keyword_baseline']['recall']} | {r['keyword_baseline']['f1']} |",
                "",
                "Recall per language: " + ", ".join(f"{k} {v}" for k, v in r["recall_per_language"].items()),
                "",
                f"Human in the loop: {card['human_in_the_loop']}",
                "",
                f"Limits: {card['limits']}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(f"Saved {artefact.name} and models/screening_card.json")


if __name__ == "__main__":
    main()
