# Dataset provenance — `listings.psv`

| Item | Record |
|---|---|
| What | 240 product concepts (40 per category) × 3 languages = 720 short listing texts (title + description) |
| Categories | `fresh-produce`, `pantry`, `clothing`, `household`, `crafts`, `personal-care` — the six labels in spec Table 34 |
| Source | **Student-authored examples**, drafted with AI writing assistance for this project. No text was scraped or copied from any marketplace, shop or website. No real sellers, customers or personal data. |
| Format | Pipe-separated: `concept_id|category|language|title|description`. All three translations of a concept share one `concept_id`, so they always land in the same split. |
| Labelling | One category per concept, assigned when the concept was written. **Second-reviewer check still to do** (spec 8.2 asks for two reviewers and a written category guide). Borderline items to discuss: handmade shea butter (personal care vs crafts), knitted baby blanket (crafts vs household), silver earrings (clothing/accessories vs crafts). |
| Translations | English reviewed by the author. **Setswana and Afrikaans are unreviewed drafts** and must be checked by fluent speakers (spec NFR-09, Table 34 "Labelling"). Setswana in particular will contain errors and some loanwords. |
| Status | Development dataset. Good enough to build and test the pipeline end to end. **Not** evidence of real-world performance — synthetic data results are not field results (spec 8.3). |

## How to replace or extend it

1. Keep the same five columns and the same six category codes.
2. Give every translation of the same product the same `concept_id`.
3. Record where each new example came from (for example "seller-provided with written permission, 2026-10-02").
4. Run `python train.py` again — it re-splits, retrains, re-evaluates and writes a new model card.

---

# Dataset provenance — `reviews.psv` (review model, Tier 2)

| Item | Record |
|---|---|
| What | 110 customer-review concepts × 3 languages = 330 short reviews |
| Labels | `sentiment` (positive 49 / neutral 25 / negative 36 concepts) and 0–3 `themes` from: fresh, tasty, friendly, quick, slow, good_price, expensive, poor_quality, cold, rude |
| Source | **Student-authored examples** written for this project, about Kuruman-style products (kota, vetkoek, morogo, bricks, lucerne…). Drafted with AI writing assistance. No real reviews, people or businesses. |
| Format | `concept_id|sentiment|themes|language|text` — themes comma-separated, `-` for none; translations share a `concept_id`. |
| Labelling | One author. **Second-reviewer check still to do**, especially neutral vs negative for mixed reviews ("tasty but cold"). |
| Translations | **Setswana and Afrikaans are unreviewed drafts**; fluent speakers must check them. |
| Status | Development data — results are not evidence of real-world performance. |

# Dataset provenance — `screening.psv` (off-platform / scam screening, Tier 2)

| Item | Record |
|---|---|
| What | 60 concepts × 3 languages = 180 texts: 30 `flag` (pay outside the site, eWallet/deposit first, phone numbers, "too good to be true") and 30 `ok` |
| Hard negatives | Half of the `ok` texts mention payment, cash, WhatsApp or delivery innocently ("Share this shop on WhatsApp", "Pay cash when you collect at the stall"), so the model can't just learn the words |
| Source | **Student-authored**, modelled on common South African marketplace scam patterns described in public consumer-safety advice. No real messages, people or phone numbers (the numbers are made up). |
| Translations | Setswana and Afrikaans unreviewed drafts. |
| Status | Development data. Scammers change wording, so this needs regular new examples — support's decisions on flags are the natural source. |

# Forecast evaluation data

`train_forecast.py` **generates synthetic sales histories** (40 made-up products × 20 weeks, fixed random seed) with known
weekday, payday-week, trend and Poisson-noise patterns. Nothing is stored; nothing comes from real sales. The demo shop's
sales history in `server/src/scripts/seed.ts` is also synthetic and labelled "synthetic demo history".
