"""
Small helpers shared by the training scripts (train_reviews.py, train_screening.py, train_forecast.py).
The category model (train.py) predates this file and keeps its own copies.
"""

import csv
import hashlib
import json
import random
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import FeatureUnion

HERE = Path(__file__).parent
SEED = 42
LANGUAGES = ["en", "tn", "af"]


def load_psv(path: Path):
    """Rows from a pipe-separated file, grouped by concept_id (all translations of one example)."""
    with open(path, encoding="utf-8") as f:
        rows = list(csv.DictReader(f, delimiter="|"))
    concepts = defaultdict(list)
    for r in rows:
        r["text"] = r["text"].strip().lower()
        concepts[r["concept_id"]].append(r)
    for cid, rs in concepts.items():
        assert sorted(x["language"] for x in rs) == sorted(LANGUAGES), f"{cid} must have en, tn and af"
    return rows, concepts


def grouped_split(concepts, label_of, test_share=0.2):
    """Development/test split by concept, stratified by label: translations never cross the split."""
    rng = random.Random(SEED)
    by_label = defaultdict(list)
    for cid, rs in concepts.items():
        by_label[label_of(rs[0])].append(cid)
    dev, test = [], []
    for label in sorted(by_label):
        ids = sorted(by_label[label])
        rng.shuffle(ids)
        n_test = max(1, round(len(ids) * test_share))
        test += ids[:n_test]
        dev += ids[n_test:]
    return sorted(dev), sorted(test)


def text_features():
    """Word and character n-grams. Characters help with Setswana and Afrikaans word forms and typos."""
    return FeatureUnion(
        [
            ("word", TfidfVectorizer(analyzer="word", ngram_range=(1, 2), sublinear_tf=True)),
            ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True)),
        ]
    )


def sha256(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_card(name: str, card: dict):
    """Model card next to the model; the service refuses a model whose hash doesn't match."""
    card = {**card, "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    path = HERE / "models" / f"{name}_card.json"
    path.write_text(json.dumps(card, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path
