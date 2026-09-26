# KurumanMarketPlace

A mobile-first marketplace PWA connecting Kuruman SMMEs, consumers and delivery partners.

- `client/` – React + TypeScript (Vite) PWA
- `server/` – Node.js + Express + TypeScript API
- `ai/` – Python category-suggestion model (TF-IDF + logistic regression) and its private service
- Database – PostgreSQL
- `docs/PROJECT_BRIEF.md` – scope, rules, design and progress · `docs/DEMO_SCRIPT.md` – presentation walkthrough

## Run it (Windows, PowerShell, from this folder)

One-off setup: install PostgreSQL, Node.js 20+ and Python 3.11+, create the database
`kuruman_marketplace`, copy `server/.env.example` to `server/.env` and fill in your password, then:

```
cd server
npm install
npm run db:setup
npm run db:seed
```
```
cd client
npm install
```
```
cd ai
pip install -r requirements.txt
```

Every time — three terminals:

| Terminal | Commands | What |
|---|---|---|
| 1 | `cd server` then `npm run dev` | API on http://localhost:4000 |
| 2 | `cd client` then `npm run dev` | Website on http://localhost:5173 |
| 3 | `cd ai` then `python service.py` | AI suggestions (optional — the app works without it) |

Demo accounts (synthetic): 071 000 0001 customer · 0002 seller · 0003 courier · 0004 support ·
0005 second seller · 0006 second courier · 0007 support (approvals only) · 0008 customer with a seller
application waiting. Passphrase: `Kuruman Oasis 2026`. Support accounts set up an authenticator app
(Google/Microsoft Authenticator) the first time they open the console.

## Tests

In `server`:

- `npm run test:kpi` — seller KPIs against the specification's worked example (TC-18)
- `npm run test:payfast` — Payfast notification contract tests (TC-11); reset the data afterwards
- `npm run test:support` — support console: applications, MFA, scopes, suspensions, audit log (TC-02, TC-21, TC-22); reset the data afterwards

In `ai`: `python train.py` retrains and re-evaluates the model (`reports/evaluation.md`).
