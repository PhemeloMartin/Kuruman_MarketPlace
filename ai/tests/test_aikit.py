"""Unit tests for aikit.py: loading the datasets and the grouped split that keeps translations together."""

import hashlib
import tempfile
import unittest
from pathlib import Path

import aikit

HEADER = "concept_id|label|language|text\n"


def psv(lines: list[str]) -> Path:
    f = tempfile.NamedTemporaryFile("w", suffix=".psv", delete=False, encoding="utf-8")
    f.write(HEADER + "\n".join(lines) + "\n")
    f.close()
    return Path(f.name)


class LoadPsvTest(unittest.TestCase):
    def test_groups_rows_by_concept_and_lowercases_text(self):
        path = psv(["c1|good|en|  Fresh SPINACH ", "c1|good|tn|Sepinatshe", "c1|good|af|Spinasie"])
        rows, concepts = aikit.load_psv(path)
        self.assertEqual(len(rows), 3)
        self.assertEqual(list(concepts), ["c1"])
        self.assertIn("fresh spinach", [r["text"] for r in concepts["c1"]])

    def test_a_concept_without_all_three_languages_is_refused(self):
        path = psv(["c1|good|en|Fresh spinach", "c1|good|tn|Sepinatshe"])
        with self.assertRaises(AssertionError):
            aikit.load_psv(path)


class GroupedSplitTest(unittest.TestCase):
    def setUp(self):
        # 10 concepts per label, each with its three translations.
        self.concepts = {
            f"{label}{i}": [{"concept_id": f"{label}{i}", "label": label, "language": lang} for lang in aikit.LANGUAGES]
            for label in ("a", "b", "c")
            for i in range(10)
        }

    def split(self):
        return aikit.grouped_split(self.concepts, lambda r: r["label"])

    def test_no_concept_is_in_both_development_and_test(self):
        dev, test = self.split()
        self.assertEqual(set(dev) & set(test), set())
        self.assertEqual(set(dev) | set(test), set(self.concepts))

    def test_every_label_has_test_concepts_in_proportion(self):
        _, test = self.split()
        for label in ("a", "b", "c"):
            self.assertEqual(sum(1 for c in test if c.startswith(label)), 2)  # 20% of 10

    def test_the_split_is_reproducible(self):
        self.assertEqual(self.split(), self.split())


class Sha256Test(unittest.TestCase):
    def test_matches_hashlib(self):
        path = psv(["c1|x|en|a", "c1|x|tn|b", "c1|x|af|c"])
        self.assertEqual(aikit.sha256(path), hashlib.sha256(path.read_bytes()).hexdigest())


if __name__ == "__main__":
    unittest.main()
