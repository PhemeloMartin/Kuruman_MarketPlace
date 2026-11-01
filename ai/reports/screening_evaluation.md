# Screening model evaluation (screening-v2)

Held-out test: 32 concepts x 3 languages. Threshold 0.49 chosen for recall >= 0.9 in cross-validation.

| | Precision | Recall | F1 |
|---|---|---|---|
| **Model + phone rule (shipped)** | 0.912 | 0.795 | 0.849 |
| Model only | 0.912 | 0.795 | 0.849 |
| Keyword baseline | 0.833 | 0.385 | 0.526 |

Recall per language: en 0.846, tn 0.769, af 0.769

Human in the loop: Never blocks, hides or deletes. A flag only puts the item on support's review list; support decides, and the decision is in the audit log.

Limits: Small synthetic dataset; scammers change wording. Unreviewed Setswana/Afrikaans. Expect some false alarms on honest texts that mention payment.
