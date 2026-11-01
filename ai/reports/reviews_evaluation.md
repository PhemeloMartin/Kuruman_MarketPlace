# Review model evaluation (reviews-v2)

Held-out test: 52 review concepts x 3 languages, never used for training or tuning.

| | Model | Keyword baseline | Majority baseline |
|---|---|---|---|
| Sentiment (macro-F1) | **0.691** | 0.308 | 0.204 |
| Themes (micro-F1) | 0.669 | 0.601 | - |

Note: reviews-v2 re-split the larger dataset, and the test set was scored once, after every choice was fixed by grouped cross-validation. Some of its concepts were also in reviews-v1's test set, which was looked at once before class balancing was added (that choice carries over), so treat small margins with care.

Sentiment macro-F1 per language: en 0.787, tn 0.596, af 0.685

Limits: Small synthetic dataset; Setswana and Afrikaans unreviewed. Sarcasm and mixed reviews are hard. The good_quality theme is new (32 concepts). Never used to hide, rank or remove reviews.
