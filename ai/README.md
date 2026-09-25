# AI category assistant (AI-01)

Suggests a category while a seller creates a listing. It is **advisory only**: the seller
always confirms or changes the category, and the product is saved with the seller's choice
(spec FR-19, section 8).

| | |
|---|---|
| Model | TF-IDF (word + character n-grams) + multinomial logistic regression (scikit-learn) |
| Labels | `fresh-produce`, `pantry`, `clothing`, `household`, `crafts`, `personal-care` |
| Languages | English, Setswana, Afrikaans |
| Data | `data/listings.psv` — 240 products × 3 languages, student-authored; see `data/PROVENANCE.md` |
| Results | `reports/evaluation.md` and `models/model_card.json` |

## Run the service (needed for suggestions)

From the project folder:

```
cd ai
python service.py
```

It listens on `127.0.0.1:5001`, only accepts requests carrying the secret `AI_SERVICE_TOKEN`
from `server/.env`, and refuses to start if the model file's SHA-256 doesn't match the model card.
If it isn't running, the app still works — sellers just pick categories by hand.

## Retrain

```
cd ai
python train.py
```

This re-splits the data by product (all translations together), tunes with grouped 5-fold
cross-validation on the 192 development products, picks the confidence threshold from
out-of-fold predictions, trains the final model, evaluates once on the 48 held-out test
products against a keyword and a majority baseline, and writes a new model card and report.

## Honest status

`category-v2` meets 5 of the 6 acceptance targets in spec 8.3. Overall macro-F1 is **0.71**
against a 0.75 target (95% interval 0.61–0.79). The dataset is small and its Setswana and
Afrikaans are unreviewed, so the next step is better data, not more tuning. See
`reports/evaluation.md`.
