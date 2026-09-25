# Evaluation report — category-v2

Generated 2026-09-25T21:37:17+00:00 by `train.py` (seed 42).

> **Read this first.** The dataset is student-authored development data, and its Setswana and
> Afrikaans have not yet been reviewed by fluent speakers. These numbers show that the pipeline
> works and is evaluated correctly. They are **not** evidence of how the model will perform on
> real Kuruman listings (spec 8.3).

## Set-up

- Model: TF-IDF (word+char, char n-grams (2, 5)) + multinomial logistic regression, C=50
- Split by product concept (all translations together): {'train': 144, 'validation': 48, 'test': 48}
- Features and C chosen by grouped 5-fold cross-validation on the 192 development concepts; threshold **0.77** chosen from the out-of-fold predictions
- Final model trained on all 192 development concepts; evaluated on the 144 held-out test texts
- Honesty note: category-v1 was scored on this test split once (macro-F1 0.661, failed). v2 changed the tuning method, not the test data; the test split is therefore not strictly untouched.

## Results on the held-out test split

| Measure | Result | Target |
|---|---|---|
| Macro-F1 (all languages) | 0.7122 (95% CI 0.6125–0.7905) | ≥ 0.75 |
| Keyword baseline macro-F1 | 0.5774 | model ≥ baseline + 0.10 |
| Majority baseline macro-F1 | 0.0476 | — |
| Precision of displayed suggestions | 0.9322 (59 shown) | ≥ 0.90 |
| Coverage (share of listings that get a suggestion) | 0.4097 | ≥ 0.40 |
| Prediction time | 0.102 ms per listing | — |

### Per language

| Language | Texts | Macro-F1 | Accuracy | Displayed precision | Coverage |
|---|---|---|---|---|---|
| en | 48 | 0.6949 | 0.7083 | 0.8947 | 0.3958 |
| tn | 48 | 0.6734 | 0.6875 | 0.96 | 0.5208 |
| af | 48 | 0.7711 | 0.7917 | 0.9333 | 0.3125 |

### Per category

| Category | Test texts | F1 |
|---|---|---|
| fresh-produce | 24 | 0.8148 |
| pantry | 24 | 0.6522 |
| clothing | 24 | 0.7391 |
| household | 24 | 0.3784 |
| crafts | 24 | 0.9167 |
| personal-care | 24 | 0.7719 |

### Confusion matrix (rows = true, columns = predicted)

| | fresh-produce | pantry | clothing | household | crafts | personal-care |
|---|---|---|---|---|---|---|
| **fresh-produce** | 22 | 0 | 0 | 1 | 0 | 1 |
| **pantry** | 5 | 15 | 1 | 0 | 0 | 3 |
| **clothing** | 1 | 0 | 17 | 3 | 2 | 1 |
| **household** | 2 | 7 | 2 | 7 | 0 | 6 |
| **crafts** | 0 | 0 | 2 | 0 | 22 | 0 |
| **personal-care** | 0 | 0 | 0 | 2 | 0 | 22 |

## Acceptance checks (spec 8.3)

- ❌ macro_f1_overall >= 0.75
- ✅ macro_f1_each_language >= 0.65
- ✅ beats strongest baseline by >= 0.10
- ✅ displayed precision >= 0.90
- ✅ coverage >= 0.40
- ✅ each language precision >= 0.80 and coverage >= 0.25

## Limits

- Only 144 test texts (48 per language), so every number carries real uncertainty — see the interval above.
- Short, clean, student-written texts are easier than real listings with slang, spelling mistakes and code-switching.
- The model abstains (shows no suggestion) below the threshold; the seller then picks the category manually.
- It is never used for pricing, credit, eligibility or any decision about a person.
