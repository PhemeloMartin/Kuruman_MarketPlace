# Screening model evaluation (screening-v1)

Held-out test: 12 concepts x 3 languages. Threshold 0.5 chosen for recall >= 0.9 in cross-validation.

| | Precision | Recall | F1 |
|---|---|---|---|
| **Model + phone rule (shipped)** | 0.765 | 0.722 | 0.743 |
| Model only | 0.765 | 0.722 | 0.743 |
| Keyword baseline | 1.0 | 0.222 | 0.364 |

Recall per language: en 0.833, tn 0.5, af 0.833

Human in the loop: Never blocks, hides or deletes. A flag only puts the item on support's review list; support decides, and the decision is in the audit log.

Limits: Very small synthetic dataset; scammers change wording. Unreviewed Setswana/Afrikaans. Expect false alarms on honest texts that mention payment.
