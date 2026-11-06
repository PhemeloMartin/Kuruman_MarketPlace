# KurumanMarketPlace

**Everything Kuruman sells, in one place.** A mobile-first marketplace (Progressive Web App) that connects
Kuruman's small and informal businesses — market stalls, food caravans, tailors, salons, brick makers,
livestock and water sellers — with local customers and local couriers.

Live: **https://kurumanmarketplace.co.za**

---

## The problem

Most of Kuruman's small businesses have no online presence. They sell to whoever walks past, take orders
in scattered WhatsApp chats and handle cash with no record. Customers can't see what's for sale without
travelling to town, and there is no trusted way to pay, deliver or sort out a problem. Many residents use
basic phones or have little data, and many prefer Setswana or Afrikaans.

## What it does

| For | Features |
|---|---|
| **Customers** | Browse markets and products, multilingual search (spinach = sepinatšhe = spinasie), cart and checkout, pay cash or online (Payfast), collect or get delivery to a map pin, live courier tracking and chat, reviews, help tickets |
| **Sellers** | Shop page with photos and voice notes, products with barcodes, AI category suggestions, accept/decline orders, sales KPIs and a 7-day sales forecast, review replies, a WhatsApp button and free calls over data |
| **Market stalls** | Take orders **by SMS** from a basic phone: reply `1` to accept, `2` if sold out, or the customer's code to hand over |
| **Couriers** | Claim delivery jobs, directions in the app (no maps app needed), live location while delivering, handover by code or QR |
| **Support staff** | A console behind two-factor sign-in: seller and courier verification, flagged content, refunds, cases, the audit log |
| **Everyone** | English, Setswana and Afrikaans · works offline for browsing · a one-time **handover code** protects every order |

Markets carry Kuruman's own stories: **Water & ice** (Leitlho, the Eye of Kuruman), **Doctors & healers**
(in honour of Credo Mutwa), **Books & lessons** (the Moffat Mission) and **Street food** (Wonderwerk Cave).
The **Kuruman Business Directory** lists local services people phone directly.

## Architecture

```
Phone / PC browser — React PWA (installable, works offline for browsing)
        │ HTTPS, one address
        ▼
Render — one Node.js / Express service
  ├─ serves the built React app
  ├─ /api/*  REST API (JSON) ──── SQL over SSL ────► Neon PostgreSQL
  ├─ background jobs: order expiry · outbox → SMS & notifications · AI worker · data retention
  └─ private calls (secret token) ──► Python AI service (scikit-learn), also on Render
Webhooks in:  Payfast ITN · BulkSMS replies · Twilio
Calls out:    Payfast · BulkSMS · Twilio · Resend · Cloudinary · OSRM (OpenStreetMap routing)
```

The website and the API are served from **one address**, so the login cookie and the CSRF origin check
work without cross-site cookies. The API is stateless (sessions live in PostgreSQL), so it can scale out
to more instances later. The AI runs as a separate service because it is a different runtime (Python).

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, React Router, PWA (vite-plugin-pwa / Workbox), Leaflet + OpenStreetMap, Twilio Voice JS SDK |
| Backend | Node.js 20, Express 5, TypeScript, `pg` (node-postgres) with parameterised SQL — no ORM |
| Database | PostgreSQL on Neon (managed cloud Postgres) — 33 tables |
| AI | Python 3.13, scikit-learn, numpy, joblib |
| Hosting | Render (Frankfurt), defined in [`render.yaml`](render.yaml); auto-deploys on every push to `main` |
| Services | Payfast (payments) · BulkSMS (SMS) · Twilio (calls) · Resend (email) · Cloudinary (photos, optional) · FOSSGIS OSRM (routing) |

## Repository layout

```
client/   React + TypeScript PWA (pages, components, offline catalogue, translations)
server/   Express + TypeScript API
  db/       schema.sql (tables) and migrations.sql (run at every start, safe to repeat)
  src/      routes/ (API), lib/ (payments, SMS, calls, security, jobs), scripts/ (setup, seed, tests)
ai/       training scripts, datasets, models with model cards, evaluation reports, prediction service
docs/     PROJECT_BRIEF.md (scope and decisions), HOSTING.md (going live), DEMO_SCRIPT.md (walkthrough)
render.yaml   the Render Blueprint: both services and their settings
```

## Database

**PostgreSQL**, because the data is relational (users → businesses → products → order items ← orders →
payments, deliveries, reviews) and money and stock need **ACID transactions and row locks**:

- `SELECT … FOR UPDATE` stops two customers buying the last item and a payment being applied twice.
- The database enforces the rules itself: `CHECK (reserved_qty <= stock_qty)`, `CHECK (rating BETWEEN 1 AND 5)`,
  prices as integer cents, and **partial unique indexes** such as one applied payment per order.
- Surrogate keys: `BIGINT GENERATED ALWAYS AS IDENTITY`; one-to-one links through a shared or `UNIQUE`
  foreign key (one shop per account, one review per order, one delivery per order).
- Order lines keep a **price snapshot**, so a later price change never alters a past order.
- The **audit log is append-only**, enforced by a trigger.
- `JSONB` only where the shape varies (audit details, notification payloads).

## Security

- **Sign-in by SMS code** for customers, sellers and couriers: 6 digits, 10 minutes, stored only as a hash,
  rate-limited.
- **Server-side sessions**: a random token in an `httpOnly`, `Secure`, `SameSite=Lax` cookie; the database
  keeps only its SHA-256 hash. Sessions can be revoked at once.
- **Two-factor sign-in for support staff**: bcrypt passphrase + TOTP (RFC 6238, authenticator app), with
  replay protection.
- **Encryption at rest** (AES-256-GCM) for ID documents and authenticator secrets; the key lives only in
  the hosting settings.
- **Verification documents** are checked by file signature, encrypted, opened only by support, and every
  view is audited. Documents are never emailed (POPIA).
- **Payments are marked paid only by Payfast's server notification**, after checking the signature, source
  IP, amount, merchant and a validation call back to Payfast; duplicates are ignored.
- Parameterised SQL everywhere, CSRF origin checks, an append-only audit log, and scheduled deletion of
  personal data (POPIA).

## AI

Four models, trained in this repository with scikit-learn. They **advise; people decide**: nothing is
blocked, hidden or priced automatically.

| Model | What it does | Method |
|---|---|---|
| Category suggestion | Suggests a product's market (English, Setswana, Afrikaans); abstains when unsure | TF-IDF (words + character n-grams) + logistic regression |
| Review analysis | Sentiment and themes ("Customers mention: fresh") | TF-IDF + logistic regression / one-vs-rest |
| Scam screening | Flags attempts to move payment off the site, for support to review | TF-IDF + balanced logistic regression + phone-number rule |
| Sales forecast | Next 7 days per product, for stock planning | Poisson regression (weekday, payday week, trend) |

Model cards, datasets and honest evaluation results are in [`ai/`](ai/README.md) and
[`ai/reports/`](ai/reports/). Each model is loaded only if its SHA-256 matches its model card.

## Run it locally (Windows, PowerShell)

Prerequisites: Node.js 20+, PostgreSQL, Python 3.11+.

1. Create a database called `kuruman_marketplace`.
2. Copy `server/.env.example` to `server/.env` and fill in your database password and a
   `DATA_ENCRYPTION_KEY` (instructions are in the file).
3. Install and fill the database:

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

4. Start it — three terminals:

| Terminal | Commands | What |
|---|---|---|
| 1 | `cd server` then `npm run dev` | API on http://localhost:4000 |
| 2 | `cd client` then `npm run dev` | Website on http://localhost:5173 |
| 3 | `cd ai` then `python service.py` | AI service (optional — the app works without it) |

**Demo accounts (local only, synthetic):** 071 000 0001 customer · 0002 seller · 0003 courier · 0004 support ·
0005 second seller · 0006 second courier · 0007 support (approvals only) · 0008 customer with a seller
application waiting. Locally the SMS code is shown on screen. Support accounts use the passphrase
`Kuruman Oasis 2026` and set up an authenticator app the first time.
On the hosted site demo sign-ins are switched off, and `SEED_PASSPHRASE` replaces the default passphrase.

**Settings:** every secret (database, Payfast, BulkSMS, Twilio, Resend, Cloudinary, encryption key) goes in
`server/.env` locally and in Render's Environment settings when hosted — never in Git. Without a provider's
keys, that feature degrades gracefully (SMS are logged instead of sent, calls are hidden, photos are kept in
the database).

## Tests

16 automated suites (about 240 checks) in `server/`. Run each on a fresh database with the dev server
stopped:

```
npm run db:setup
npm run db:seed
npm run test:payfast
```

| Suite | Covers |
|---|---|
| `test:kpi` | Seller KPIs against the specification's worked example |
| `test:payfast` | Payfast checkout and notification contract: signatures, amounts, duplicates, late payments |
| `test:support` | Seller onboarding, encrypted ID documents, the support console, two-factor sign-in, the audit log |
| `test:refunds` | Refunds capped at what was paid, provider evidence, cash disputes |
| `test:operations` | Failed deliveries, cancellations with refunds, returns and restock, unclaimed jobs |
| `test:privacy` | Download my data, corrections, account closure with lawful holds, retention |
| `test:notifications` | Notifications survive a failing worker and are never duplicated |
| `test:signin` | Sign-in with an SMS code |
| `test:photos` | Who may upload photos, real-image checks, limits |
| `test:reviews` | Only real buyers review, once per order; seller replies; hidden reviews |
| `test:sharing` | Collection-only items, WhatsApp, barcodes, link previews, robots.txt and the sitemap |
| `test:stalls` | Market stalls taking orders by SMS |
| `test:ai` | Review analysis, scam screening, forecast, multilingual search, AI service down |
| `test:extras` | Voice notes, the Business Directory, the WhatsApp channel post, free calls, real SMS |
| `test:tracking` | Map pins, in-app directions, live courier location, chat and "I'm outside" |
| `test:sms` | SMS in three languages, each within one 160-character GSM-7 message |

**Python unit tests (AI component)** — 37 tests with `unittest`, in `ai/tests/`: the forecast features and
payday rule, the grouped data split, abstaining below the confidence threshold, scam screening, review
analysis, model-file integrity and the AI service's HTTP layer (token, unknown paths, bad input). From `ai/`:

```
python -m unittest discover -s tests -t . -v
```

In `ai/`: `python train.py` (and `train_reviews.py`, `train_screening.py`, `train_forecast.py`) retrain
and re-evaluate the models.

## Deployment

The site runs on **Render** with the database on **Neon**. [`render.yaml`](render.yaml) declares both
services (the website on the paid always-on plan, the AI service on the free plan) and every setting; secrets
are typed into Render's dashboard. Every push to `main` builds and deploys automatically, and
`server/db/migrations.sql` updates the hosted database on start-up. Step-by-step instructions:
[`docs/HOSTING.md`](docs/HOSTING.md).

## Known limitations

- **Online payment runs on Payfast's sandbox** until the live merchant account completes Payfast's FICA
  verification; then it switches with one setting (`PAYFAST_SANDBOX=false` plus the live keys).
- **Free calls** can be one-way on networks that block incoming WebRTC audio (some campus Wi-Fi), and one
  mobile network rejected the international caller ID.
- **Setswana and Afrikaans** come from Google Translate for now; reviewed translations by fluent speakers
  should replace them.
- **AI training data** is student-written and small; the Setswana and Afrikaans examples are not yet
  reviewed by fluent speakers.
- **No OCR**: a person checks every verification document.
- One server instance; scaling out would move rate limits to a shared store such as Redis.

## Documentation

- [`docs/PROJECT_BRIEF.md`](docs/PROJECT_BRIEF.md) — scope, business rules, design decisions and progress
- [`docs/HOSTING.md`](docs/HOSTING.md) — putting it online (Render + Neon)
- [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) — presentation walkthrough
- [`ai/README.md`](ai/README.md) — the AI models, data and evaluation

---

Final-year project by **Phemelo Martin**.
