"""
Train and evaluate the listing-category assistant (spec section 8, model card AI-01).

    python train.py

Steps, each matching the specification:
  1. Load and check the dataset (240 concepts x 3 languages).
  2. Grouped, stratified 60/20/20 split by concept - all translations of one product
     stay together, so the test set never contains a translation of a training item.
  3. Choose features and C by 5-fold GROUPED cross-validation on the development data
     (train + validation concepts, 192 of 240) - never on the test concepts.
  4. Choose the confidence threshold from the out-of-fold predictions (precision >= 0.90 target).
  5. Fit the final TF-IDF + multinomial logistic regression on all development data.
  6. Only then evaluate on the held-out TEST split, against two baselines.
  7. Save the model, its SHA-256 hash, and a model card with all metrics.

History: category-v1 tuned on the single 48-concept validation split and scored 0.661
macro-F1 on test (failed the 0.75 target). With so little data a single validation split
is too noisy, so v2 tunes with grouped cross-validation instead. v1's test score was seen,
so the test split is no longer strictly untouched - this is stated in the model card.
"""

import csv
import hashlib
import json
import random
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix, f1_score
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import FeatureUnion, Pipeline

SEED = 42
MODEL_VERSION = "category-v2"
HERE = Path(__file__).parent
DATA = HERE / "data" / "listings.psv"
KEYWORDS = HERE / "data" / "keywords.json"
MODELS = HERE / "models"
REPORTS = HERE / "reports"

LABELS = ["fresh-produce", "pantry", "clothing", "household", "crafts", "personal-care"]
LANGUAGES = ["en", "tn", "af"]

# Targets from spec 8.3.
TARGET_MACRO_F1 = 0.75
TARGET_MACRO_F1_PER_LANGUAGE = 0.65
TARGET_BASELINE_MARGIN = 0.10
TARGET_PRECISION = 0.90
TARGET_COVERAGE = 0.40
TARGET_PRECISION_PER_LANGUAGE = 0.80
TARGET_COVERAGE_PER_LANGUAGE = 0.25


# ---------------------------------------------------------------------------
# 1. Data
# ---------------------------------------------------------------------------
def load_rows():
    with open(DATA, encoding="utf-8") as f:
        rows = list(csv.DictReader(f, delimiter="|"))
    for r in rows:
        r["text"] = f"{r['title']}. {r['description']}".lower()

    concepts = defaultdict(list)
    for r in rows:
        assert r["category"] in LABELS, f"unknown category {r['category']}"
        assert r["language"] in LANGUAGES, f"unknown language {r['language']}"
        concepts[r["concept_id"]].append(r)
    for cid, rs in concepts.items():
        assert sorted(x["language"] for x in rs) == sorted(LANGUAGES), f"{cid} must have en, tn and af"
        assert len({x["category"] for x in rs}) == 1, f"{cid} has mixed categories"
    return rows, concepts


# ---------------------------------------------------------------------------
# 2. Grouped, stratified split by concept
# ---------------------------------------------------------------------------
def split_concepts(concepts):
    rng = random.Random(SEED)
    by_label = defaultdict(list)
    for cid, rs in concepts.items():
        by_label[rs[0]["category"]].append(cid)
    manifest = {"train": [], "validation": [], "test": []}
    for label in LABELS:
        ids = sorted(by_label[label])
        rng.shuffle(ids)
        n = len(ids)
        n_train, n_val = round(n * 0.6), round(n * 0.2)
        manifest["train"] += ids[:n_train]
        manifest["validation"] += ids[n_train : n_train + n_val]
        manifest["test"] += ids[n_train + n_val :]
    for part in manifest.values():
        part.sort()
    return manifest


def rows_for(concepts, ids):
    return [r for cid in ids for r in concepts[cid]]


# ---------------------------------------------------------------------------
# 3-4. Model and tuning
# ---------------------------------------------------------------------------
def build_model(features, c, char_range=(3, 5)):
    parts = []
    if features in ("word", "word+char"):
        parts.append(("word", TfidfVectorizer(analyzer="word", ngram_range=(1, 2), min_df=1, sublinear_tf=True)))
    if features in ("char", "word+char"):
        # Character n-grams help with Setswana/Afrikaans word forms and spelling variation.
        parts.append(("char", TfidfVectorizer(analyzer="char_wb", ngram_range=char_range, min_df=1, sublinear_tf=True)))
    return Pipeline(
        [
            ("features", FeatureUnion(parts)),
            ("clf", LogisticRegression(C=c, max_iter=2000, random_state=SEED)),
        ]
    )


def macro_f1(y_true, y_pred):
    return f1_score(y_true, y_pred, labels=LABELS, average="macro", zero_division=0)


# ---------------------------------------------------------------------------
# 5. Threshold: show a suggestion only when the model is confident enough
# ---------------------------------------------------------------------------
def displayed_stats(y_true, y_pred, scores, threshold):
    shown = [(t, p) for t, p, s in zip(y_true, y_pred, scores) if s >= threshold]
    coverage = len(shown) / len(y_true) if y_true else 0.0
    precision = sum(t == p for t, p in shown) / len(shown) if shown else None
    return precision, coverage, len(shown)


def choose_threshold(y_true, y_pred, scores):
    """Lowest threshold whose displayed-suggestion precision meets the target (maximises coverage)."""
    for t in np.round(np.arange(0.20, 0.96, 0.01), 2):
        precision, coverage, _ = displayed_stats(y_true, y_pred, scores, t)
        if precision is not None and precision >= TARGET_PRECISION:
            return float(t)
    return 0.95


# ---------------------------------------------------------------------------
# Baselines (spec 8.2)
# ---------------------------------------------------------------------------
def majority_baseline(train_rows, test_rows):
    majority = Counter(r["category"] for r in train_rows).most_common(1)[0][0]
    return [majority] * len(test_rows)


def keyword_baseline(train_rows, test_rows):
    keywords = {k: v for k, v in json.loads(KEYWORDS.read_text(encoding="utf-8")).items() if not k.startswith("_")}
    majority = Counter(r["category"] for r in train_rows).most_common(1)[0][0]
    preds = []
    for r in test_rows:
        words = set(r["text"].replace(",", " ").replace(".", " ").split())
        hits = {label: sum(1 for kw in kws if kw in words) for label, kws in keywords.items()}
        best = max(hits.values())
        winners = [label for label, h in hits.items() if h == best]
        preds.append(winners[0] if best > 0 and len(winners) == 1 else majority)
    return preds


def bootstrap_ci(test_rows, y_pred, n=1000):
    """95% interval for macro-F1, resampling whole concepts (not single texts)."""
    rng = random.Random(SEED)
    by_concept = defaultdict(list)
    for i, r in enumerate(test_rows):
        by_concept[r["concept_id"]].append(i)
    ids = list(by_concept)
    values = []
    for _ in range(n):
        sample = [i for cid in (rng.choice(ids) for _ in ids) for i in by_concept[cid]]
        values.append(macro_f1([test_rows[i]["category"] for i in sample], [y_pred[i] for i in sample]))
    return float(np.percentile(values, 2.5)), float(np.percentile(values, 97.5))


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    rows, concepts = load_rows()
    manifest = split_concepts(concepts)
    train, val, test = (rows_for(concepts, manifest[k]) for k in ("train", "validation", "test"))
    print(f"Concepts train/val/test: {len(manifest['train'])}/{len(manifest['validation'])}/{len(manifest['test'])}")
    print(f"Texts    train/val/test: {len(train)}/{len(val)}/{len(test)}")

    # Development data = train + validation concepts. The test concepts are not touched here.
    dev = train + val
    x_dev, y_dev = [r["text"] for r in dev], [r["category"] for r in dev]
    groups = [r["concept_id"] for r in dev]
    folds = list(StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SEED).split(x_dev, y_dev, groups))

    def cross_validate(features, c, char_range):
        """Out-of-fold probabilities: each text is predicted by a model that never saw its concept."""
        proba = np.zeros((len(dev), len(LABELS)))
        for fit_idx, hold_idx in folds:
            m = build_model(features, c, char_range).fit([x_dev[i] for i in fit_idx], [y_dev[i] for i in fit_idx])
            order = [list(m.classes_).index(label) for label in LABELS]
            proba[hold_idx] = m.predict_proba([x_dev[i] for i in hold_idx])[:, order]
        return proba

    tuning = []
    for features in ("word", "char", "word+char"):
        for char_range in ([(3, 5)] if features == "word" else [(2, 4), (2, 5), (3, 5)]):
            for c in (1, 2, 5, 10, 20, 50):
                proba = cross_validate(features, c, char_range)
                pred = [LABELS[i] for i in proba.argmax(1)]
                tuning.append({
                    "features": features, "char_range": list(char_range), "C": c,
                    "cv_macro_f1": round(macro_f1(y_dev, pred), 4),
                })
    best = max(tuning, key=lambda t: (t["cv_macro_f1"], -t["C"]))
    print(f"Best by grouped 5-fold CV: {best}")

    oof = cross_validate(best["features"], best["C"], tuple(best["char_range"]))
    oof_pred = [LABELS[i] for i in oof.argmax(1)]
    threshold = choose_threshold(y_dev, oof_pred, oof.max(1))
    val_precision, val_coverage, _ = displayed_stats(y_dev, oof_pred, oof.max(1), threshold)
    print(f"Threshold chosen on out-of-fold predictions: {threshold} (precision {val_precision:.3f}, coverage {val_coverage:.3f})")

    model = build_model(best["features"], best["C"], tuple(best["char_range"])).fit(x_dev, y_dev)
    classes = list(model.classes_)

    # --- The test split is used from here on, once. ---
    x_test, y_test = [r["text"] for r in test], [r["category"] for r in test]
    started = time.perf_counter()
    test_proba = model.predict_proba(x_test)
    latency_ms = (time.perf_counter() - started) * 1000 / len(x_test)
    test_pred = [classes[i] for i in test_proba.argmax(1)]
    test_scores = test_proba.max(1)

    overall_f1 = macro_f1(y_test, test_pred)
    ci_low, ci_high = bootstrap_ci(test, test_pred)
    precision, coverage, shown = displayed_stats(y_test, test_pred, test_scores, threshold)

    per_language = {}
    for lang in LANGUAGES:
        idx = [i for i, r in enumerate(test) if r["language"] == lang]
        yt, yp, sc = [y_test[i] for i in idx], [test_pred[i] for i in idx], [test_scores[i] for i in idx]
        p, cov, n_shown = displayed_stats(yt, yp, sc, threshold)
        per_language[lang] = {
            "texts": len(idx),
            "macro_f1": round(macro_f1(yt, yp), 4),
            "accuracy": round(sum(a == b for a, b in zip(yt, yp)) / len(idx), 4),
            "displayed": n_shown,
            "displayed_precision": None if p is None else round(p, 4),
            "coverage": round(cov, 4),
        }

    per_class = {}
    for label in LABELS:
        f1 = f1_score(y_test, test_pred, labels=[label], average=None, zero_division=0)[0]
        per_class[label] = {"support": y_test.count(label), "f1": round(float(f1), 4)}

    baselines = {
        "majority": round(macro_f1(y_test, majority_baseline(train, test)), 4),
        "keyword": round(macro_f1(y_test, keyword_baseline(train, test)), 4),
    }
    strongest_baseline = max(baselines.values())

    checks = {
        "macro_f1_overall >= 0.75": overall_f1 >= TARGET_MACRO_F1,
        "macro_f1_each_language >= 0.65": all(v["macro_f1"] >= TARGET_MACRO_F1_PER_LANGUAGE for v in per_language.values()),
        "beats strongest baseline by >= 0.10": overall_f1 - strongest_baseline >= TARGET_BASELINE_MARGIN,
        "displayed precision >= 0.90": precision is not None and precision >= TARGET_PRECISION,
        "coverage >= 0.40": coverage >= TARGET_COVERAGE,
        "each language precision >= 0.80 and coverage >= 0.25": all(
            v["displayed_precision"] is not None
            and v["displayed_precision"] >= TARGET_PRECISION_PER_LANGUAGE
            and v["coverage"] >= TARGET_COVERAGE_PER_LANGUAGE
            for v in per_language.values()
        ),
    }

    # --- Save the model and its card. ---
    MODELS.mkdir(exist_ok=True)
    REPORTS.mkdir(exist_ok=True)
    model_path = MODELS / f"{MODEL_VERSION}.joblib"
    joblib.dump({"pipeline": model, "labels": classes, "version": MODEL_VERSION}, model_path)
    (MODELS / "split_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    card = {
        "model_version": MODEL_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "artefact": model_path.name,
        "artefact_sha256": sha256(model_path),
        "dataset_sha256": sha256(DATA),
        "dataset_note": "Student-authored development data; Setswana/Afrikaans unreviewed. Not field performance.",
        "seed": SEED,
        "model": f"TF-IDF ({best['features']}, char n-grams {tuple(best['char_range'])}) + multinomial logistic regression, C={best['C']}",
        "trained_on": "all development concepts (train + validation), 192 concepts / 576 texts",
        "test_split_note": "category-v1 was scored on this test split once (macro-F1 0.661, failed). v2 changed the tuning method, not the test data; the test split is therefore not strictly untouched.",
        "labels": classes,
        "threshold": threshold,
        "split": {k: len(v) for k, v in manifest.items()},
        "tuning_grouped_cv": tuning,
        "out_of_fold": {"displayed_precision": val_precision, "coverage": val_coverage},
        "test": {
            "texts": len(test),
            "macro_f1": round(overall_f1, 4),
            "macro_f1_95ci": [round(ci_low, 4), round(ci_high, 4)],
            "displayed": shown,
            "displayed_precision": None if precision is None else round(precision, 4),
            "coverage": round(coverage, 4),
            "latency_ms_per_text": round(latency_ms, 3),
            "per_language": per_language,
            "per_class": per_class,
            "baselines_macro_f1": baselines,
            "confusion_matrix": {"labels": LABELS, "rows_true_cols_pred": confusion_matrix(y_test, test_pred, labels=LABELS).tolist()},
        },
        "acceptance_checks": checks,
    }
    (MODELS / "model_card.json").write_text(json.dumps(card, indent=2), encoding="utf-8")
    write_report(card)

    print(f"\nTest macro-F1: {overall_f1:.3f} (95% CI {ci_low:.3f}-{ci_high:.3f})")
    print(f"Baselines: {baselines}")
    print(f"Displayed precision {precision}, coverage {coverage:.3f}")
    for lang, v in per_language.items():
        print(f"  {lang}: macro-F1 {v['macro_f1']}, precision {v['displayed_precision']}, coverage {v['coverage']}")
    for name, ok in checks.items():
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    print(f"\nSaved {model_path} (sha256 {card['artefact_sha256'][:16]}...) and models/model_card.json")


def write_report(card):
    t = card["test"]
    lines = [
        f"# Evaluation report — {card['model_version']}",
        "",
        f"Generated {card['created_at']} by `train.py` (seed {card['seed']}).",
        "",
        "> **Read this first.** The dataset is student-authored development data, and its Setswana and",
        "> Afrikaans have not yet been reviewed by fluent speakers. These numbers show that the pipeline",
        "> works and is evaluated correctly. They are **not** evidence of how the model will perform on",
        "> real Kuruman listings (spec 8.3).",
        "",
        "## Set-up",
        "",
        f"- Model: {card['model']}",
        f"- Split by product concept (all translations together): {card['split']}",
        f"- Features and C chosen by grouped 5-fold cross-validation on the 192 development concepts; threshold **{card['threshold']}** chosen from the out-of-fold predictions",
        f"- Final model trained on all 192 development concepts; evaluated on the {t['texts']} held-out test texts",
        f"- Honesty note: {card['test_split_note']}",
        "",
        "## Results on the held-out test split",
        "",
        "| Measure | Result | Target |",
        "|---|---|---|",
        f"| Macro-F1 (all languages) | {t['macro_f1']} (95% CI {t['macro_f1_95ci'][0]}–{t['macro_f1_95ci'][1]}) | ≥ 0.75 |",
        f"| Keyword baseline macro-F1 | {t['baselines_macro_f1']['keyword']} | model ≥ baseline + 0.10 |",
        f"| Majority baseline macro-F1 | {t['baselines_macro_f1']['majority']} | — |",
        f"| Precision of displayed suggestions | {t['displayed_precision']} ({t['displayed']} shown) | ≥ 0.90 |",
        f"| Coverage (share of listings that get a suggestion) | {t['coverage']} | ≥ 0.40 |",
        f"| Prediction time | {t['latency_ms_per_text']} ms per listing | — |",
        "",
        "### Per language",
        "",
        "| Language | Texts | Macro-F1 | Accuracy | Displayed precision | Coverage |",
        "|---|---|---|---|---|---|",
    ]
    for lang, v in t["per_language"].items():
        lines.append(f"| {lang} | {v['texts']} | {v['macro_f1']} | {v['accuracy']} | {v['displayed_precision']} | {v['coverage']} |")
    lines += ["", "### Per category", "", "| Category | Test texts | F1 |", "|---|---|---|"]
    for label, v in t["per_class"].items():
        lines.append(f"| {label} | {v['support']} | {v['f1']} |")
    cm = t["confusion_matrix"]
    lines += ["", "### Confusion matrix (rows = true, columns = predicted)", "", "| | " + " | ".join(cm["labels"]) + " |", "|---" * (len(cm["labels"]) + 1) + "|"]
    for label, row in zip(cm["labels"], cm["rows_true_cols_pred"]):
        lines.append(f"| **{label}** | " + " | ".join(str(x) for x in row) + " |")
    lines += ["", "## Acceptance checks (spec 8.3)", ""]
    for name, ok in card["acceptance_checks"].items():
        lines.append(f"- {'✅' if ok else '❌'} {name}")
    lines += [
        "",
        "## Limits",
        "",
        f"- Only {t['texts']} test texts ({t['texts'] // 3} per language), so every number carries real uncertainty — see the interval above.",
        "- Short, clean, student-written texts are easier than real listings with slang, spelling mistakes and code-switching.",
        "- The model abstains (shows no suggestion) below the threshold; the seller then picks the category manually.",
        "- It is never used for pricing, credit, eligibility or any decision about a person.",
    ]
    (REPORTS / "evaluation.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
