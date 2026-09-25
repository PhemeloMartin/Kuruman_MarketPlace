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
