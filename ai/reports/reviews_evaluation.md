# Review model evaluation (reviews-v1)

Held-out test: 23 review concepts x 3 languages, never used for training or tuning.

| | Model | Keyword baseline | Majority baseline |
|---|---|---|---|
| Sentiment (macro-F1) | **0.505** | 0.381 | 0.202 |
| Themes (micro-F1) | 0.599 | 0.559 | - |

Note: The test reviews were scored once before class balancing was added (themes then lost to the keyword lexicon). Balancing was chosen by grouped cross-validation only, but the test set is no longer strictly unseen. The themes margin over the lexicon is small on 23 concepts: treat the two as roughly equal.

Sentiment macro-F1 per language: en 0.589, tn 0.465, af 0.437

Limits: Small synthetic dataset; Setswana and Afrikaans unreviewed. Sarcasm and mixed reviews are hard. Never used to hide, rank or remove reviews.
