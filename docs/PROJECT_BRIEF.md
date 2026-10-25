# KurumanMarketPlace — Project Brief

This brief is the working guide for building the project. The academic specification is
`KurumanMarketPlace_Consolidated_Project_Documentation.docx` (kept outside the repo).
**Where this brief and the specification disagree, this brief wins** — the differences are listed in section 3.

---

## 1. What the project is

A mobile-first marketplace connecting small businesses (SMMEs) in Kuruman, Northern Cape, South Africa,
with local customers and delivery couriers.

| Role | What they do |
|---|---|
| Consumer | Browse the catalogue, order, pay cash or online, collect or receive delivery |
| Entrepreneur (seller) | List products, accept or decline incoming orders, mark ready, view KPIs |
| Courier | See open delivery jobs, claim one, collect from seller, hand over to customer |

**Support staff** use a separate restricted console. Support is not a public sign-up role.
Everyone registers as a consumer; entrepreneur and courier access are *approved grants*, never
something the browser can choose for itself.

**Academic context:** a final-year project that is presented and defended orally. Favour clear,
conventional code over clever code, and explain *why* as we go.

---

## 2. Non-negotiable business rules

1. **One business per order.** A cart may not mix products from two sellers, and switching seller needs an explicit choice.
2. **Money is whole cents** in `INTEGER` columns and in the API (`*_cents`). Format to rands only in the UI.
3. **Seller accepts first, payment second.** Online payment is requested only after acceptance.
4. **Stock is reserved atomically** on submission: one transaction, rows locked in sorted id order (`SELECT … FOR UPDATE`).
5. **Offline drafts are never orders.** They show "Not submitted" until explicitly submitted online.
6. **Courier claims are atomic.** Two couriers can never both win the same job.
7. **Fixed sale units** (`unit_label`, e.g. "1 bunch", "1 × 5 kg bag"); quantity is a positive integer.
8. **Every status change is recorded** in `order_status_history`.
9. **Order items store a snapshot** of name, unit and price.
10. **AI category suggestion is advisory.** The seller always confirms or overrides.
11. **Duplicate or forged payment notifications are rejected** (unique provider reference, verified signature).
12. **POPIA:** synthetic demo data only; export/deletion requests are later scope.
13. **The server trusts nothing the browser sends** about identity, role, owner, price, total or status — it derives them itself.

Pilot time windows (spec BR-06): seller must respond within **30 min**; online payment within **15 min** of acceptance;
handover code valid **15 min**, max 5 wrong attempts.

---

## 3. Decisions that override the specification

| Topic | Specification | Agreed decision |
|---|---|---|
| Timeline | 16 weeks, ~320 h | Compressed; core flow first. |
| Platform | PWA | PWA only for now. |
| Languages | Full reviewed i18n | Phase 1: Google Translate widget, documented as temporary. Human review of payment/legal wording still required (NFR-09). |
| Hosting | Hosted, SA region preferred | Deferred. Build locally; keep code deployment-ready (config via env vars). |
| Schema | 27 tables | 14 tables so far (core 9 + sessions, cash_receipts, ai_suggestions, payment_events, and payments used as payment attempts); the rest added as features need them. |
| Categories | Six AI labels (spec Table 34) | The catalogue uses the same six: fresh produce, pantry & groceries, clothing & accessories, household, crafts & gifts, personal care. |
| Payfast credentials | — | The shared public sandbox merchant's passphrase no longer matches, so online payment stays off until the student's own free sandbox account is configured. Contract tests cover the verification logic. |
| Order state names | `PENDING_SELLER`, … | Lower-case names in the DB: `pending_acceptance`, `awaiting_payment`, `confirmed`, `ready`, `out_for_delivery`, `completed`, `declined`, `cancelled`, `expired`. Same meaning. |
| Password hashing | Argon2id | bcrypt (cost 10) for the MVP — well-known, no native build on Windows. Argon2id is the documented upgrade. Only support staff (and seeded demo accounts) have a passphrase now. |
| Sign-in | Phone + passphrase (spec 7.3) | **One-time SMS code** for customers, sellers and couriers (no password; inclusive for elderly users). Support keeps passphrase + authenticator app. Until an SMS gateway is connected, demo mode shows the code on screen (`SMS_DEMO_SHOW_CODES`). |
| Session length | 30 min idle / 12 h (spec 9.2) | Support keeps 30 min / 12 h. Others: 14 days idle / 30 days, so a paid SMS isn't needed every visit; "Sign out" ends it at once on a shared phone. |
| API prefix | `/api/v1/…` | `/api/…` for the MVP. |
| Imagery | — | Local Kuruman imagery in decorative areas only (banner, login, empty states, About). Never behind prices, totals or buttons. Product photos are the seller's own. Lawfully licensed, WebP ~100–200 KB. |

**Build order**

1. Foundation — repo, schema, auth, language switcher
2. Core transaction — catalogue, cart, order submit with reservation, seller accept/decline, cash + pickup end to end
3. Delivery — courier job board, atomic claim, collection, handover code, cash remittance
4. Payfast sandbox
5. PWA offline
6. KPIs and the AI category model (TF-IDF + logistic regression, Python)
7. Polish — support console, privacy requests, remaining tables

Steps 1–3 alone produce a presentable demo.

---

## 4. Look and feel — "Oasis of the Kalahari"

Clean, simple, for the people, by the people. Mobile-first (390 px design width), plain everyday
wording, large tap targets (48 × 48 px), WCAG 2.2 AA contrast.

| Token | Hex | Use |
|---|---|---|
| Background | `#FFFCF7` | Page background (warm near-white) |
| Surface | `#FFFFFF` | Cards |
| Primary (oasis green) | `#1E6B5A` | Buttons, active states, links |
| Primary dark | `#154D41` | Hover, headings on tint |
| Primary tint | `#DDF1EA` | Selected option backgrounds |
| Accent (Kalahari ochre) | `#A8462A` | Prices, totals, urgency — sparingly |
| Ink | `#22201C` | Body text |
| Muted | `#5E574D` | Secondary text |
| Border | `#F1E7DA` | Card borders |
| Border strong | `#EADFCF` | Inputs, outline buttons |
| Sand / dune | `#E9B98A`, `#C8683F` | Decoration only |
| Sun | `#F2C57C` | Decoration only |

**Type:** Fraunces (serif) for headings and numbers; Figtree (sans) for everything else.
**Motifs:** thin three-layer dune ribbon at the top of each screen; SVG Mokala (camel thorn) tree at sunset in the Home banner.
**Screens designed:** Home/catalogue, Cart & checkout, Seller dashboard. Bottom nav: Home, Cart, Orders, Profile. Language selector top-right.
**Copy:** "Buy local. Support Kuruman.", "Send order to seller", "How do you want it?", "You only pay online after the seller accepts your order."

---

## 5. Running it locally (Windows, PowerShell)

Terminal 1 — API (from the project folder):

```
cd server
npm run dev
```

Terminal 2 — website:

```
cd client
npm run dev
```

Website: http://localhost:5173 · API health: http://localhost:4000/api/health

Reset the database with demo data (deletes everything): `npm run db:setup` then `npm run db:seed` in `server`.
KPI check against the spec's worked example: `npm run test:kpi` in `server` (changes nothing).

**Demo accounts** (synthetic) — see the output of `npm run db:seed` for the passphrase.

| Phone | Name | Role |
|---|---|---|
| 071 000 0001 | Thato | consumer |
| 071 000 0002 | Kgomotso | entrepreneur |
| 071 000 0003 | Pieter | courier |
| 071 000 0004 | Support | support |
| 071 000 0005 | Naledi | entrepreneur (second seller) |
| 071 000 0006 | Lerato | courier (second courier) |
| 071 000 0007 | Sipho | support, **approvals only** (shows scope refusal) |
| 071 000 0008 | Boitumelo | consumer with a seller application waiting for support |
| 071 000 0009 | Tumelo | entrepreneur (building materials, animal feed, livestock) |
| 071 000 0010 | Dineo | entrepreneur (street food caravan) |
| 071 000 0011–13 | Lesego, Anna, Kabelo | consumers with past orders and reviews (demo history) |

Everyone except support signs in with an SMS code (shown on screen in demo mode). Support accounts use **Support staff sign-in** with the passphrase, and also need an authenticator app (Google/Microsoft Authenticator) the first time they
open the console: scan the QR code shown, then enter the 6-digit code.

---

## 6. Conventions

- TypeScript, `strict`, client and server.
- API routes under `/api/…`, JSON in and out. Log details server-side; return a safe plain-language message.
- No secrets in the repo; everything through `.env`, and keep `.env.example` current.
- Passphrases hashed with bcrypt; never logged or printed.
- Transactions with row locks for anything touching stock, order status, delivery claims or payments.
- Commit after each working step — the history is progress evidence.
- When giving terminal commands: one at a time, and say which folder the prompt should show.

---

## 7. What only the student can provide

- A labelled product dataset (lawful provenance) for the AI category model.
- Human review of Setswana and Afrikaans wording.
- Original Kuruman photographs, if they replace the SVG illustrations.
- Hosting accounts when deployment starts.

---

## 8. Progress

- [x] API, database schema, demo data
- [x] Accounts: register / sign in / sign out, server-side sessions (HttpOnly cookie), roles from the database
- [x] Catalogue API: categories, products with search and category filter, product details
- [x] Home screen in the agreed design, wired to the API; language selector (Google Translate, phase 1)
- [x] Cart: one seller per order (explicit "start a new cart?" choice), saved on the phone as a draft, re-checked against the server
- [x] Order submission (TX-01): products locked in id order, stock reserved atomically, snapshot items, history row, duplicate-tap protection (Idempotency-Key)
- [x] Customer can cancel while waiting for the seller; unanswered orders expire after 30 min and release stock
- [x] Seller dashboard: accept / decline with reason / mark ready, auto-refresh, KPIs per spec Table 32
- [x] KPI fixture test TC-18 (`npm run test:kpi` in `server`) matches spec Table 33
- [x] Pickup handover: customer's one-time 6-digit code (15 min, 5 tries), stock consumed once, cash receipt
- [x] Seller products: list with available / held stock, add and edit, hide/show; stock can't drop below reservations
- [x] Courier flow: job board (area + fee only), atomic claim (first courier wins), seller "hand over",
      collect (stock consumed once), deliver with the customer's one-time code
- [x] Cash from couriers: courier collection and seller confirmation are separate events;
      a different amount is recorded as disputed and stays visible as unreconciled cash
- [x] Disputed-cash resolution (support console, stage 2)
- [x] Failed delivery / returns (support console, stage 3)
- [x] AI category assistant (ai/): 720-text student-authored dataset, grouped split, grouped CV, keyword and
      majority baselines, model card with artefact hash, private token-protected service, seller confirms every
      suggestion; category-v2 meets 5 of 6 spec 8.3 targets (macro-F1 0.71 vs 0.75 - needs better data)
- [x] Payfast sandbox: seller-first checkout, signed form, verified ITN (signature, merchant, source IP, amount,
      server validation), duplicates ignored, late/second captures kept for refund; TC-11 contract tests (13 checks)
- [x] Offline PWA: installable, app shell cached, public catalogue saved with its age (24 h stale / 7 days discard),
      "Not submitted" cart drafts, private API answers no-store, sign-out clears the cart
- [x] Presentation walkthrough: docs/DEMO_SCRIPT.md
- [x] Support console, stage 1: authenticator-app MFA for support (RFC 6238, secret encrypted with AES-256-GCM,
      codes can't be reused), staff scopes, seller/courier applications with approve/reject + reason,
      suspend/reinstate shops and couriers, append-only audit log (database trigger refuses UPDATE/DELETE);
      TC-02/TC-21/TC-22 tests (`npm run test:support`, 19 checks)
- [x] Support console, stage 2 (money): late/second Payfast payments and cash shortfalls open cases automatically;
      refunds are separate records, capped at the captured amount under a row lock, and only "succeeded" with
      Payfast's refund reference (also a database CHECK); cash shortfalls stay visible until handed over (no
      write-off); notes kept in the audit log; TC-16 tests (`npm run test:refunds`, 14 checks)
- [x] Support console, stage 3 (operations): courier reports "not delivered" with a reason (order becomes
      delivery_failed, code stops working, case opens); support tries again or cancels (paid -> refund case
      automatically); courier returns goods, seller inspects and chooses restock; jobs unclaimed for 30 min go to
      support once (BR-10); customers report problems for 7 days after completion; viewing phone numbers is
      audited; tests `npm run test:operations` (15 checks)
- [x] Privacy (FR-20, BR-16): draft privacy notice (responsible party left as a marked placeholder); download my
      data (passphrase re-check, own data only, tracked); correct name; correction and account-closure requests
      handled by support with the "privacy" scope and a 30-day due date; lawful holds checked live; closure erases
      phone, passphrase, name, addresses and sessions but keeps transactions as "Closed account"; retention job
      (addresses 30 days after an order ends unless a case is open, dead sessions, AI outcomes 30 days, closed-case
      details 90 days); TC-20 tests (`npm run test:privacy`, 15 checks)
- [x] Notifications (FR-17, TC-17): transactional outbox written in the same transaction as every status change
      (one function, recordStatusChange), refunds, application decisions and privacy holds; worker every 5 s with
      SKIP LOCKED, backoff and 'failed' after 5 tries (visible and retryable in the support console); in-app
      notifications stored as template key + values, UNIQUE per person per event; bell and badges; 30-day retention;
      tests `npm run test:notifications` (9 checks)
- [x] Hosting preparation: production mode serves the built website and API from one address (hashed assets cached
      a year, app shell/service worker re-checked, HTTPS-only cookie), render.yaml blueprint (website+API service
      and AI service with a generated token), pinned AI library versions, private SEED_PASSPHRASE for hosted demo
      data, constant-time AI token check, step-by-step docs/HOSTING.md
- [x] Landing page redesign: welcome banner with "I want to buy / I want to sell" tabs, market dropdown + search,
      "Shop by market" tiles (10 markets, incl. street food, building materials, livestock, animal feed) with item
      counts, results view in the address bar (?market=…&q=…, shareable), wide layout on laptops; one account for
      everyone, sign-in takes each role to its own area
- [x] Sign-in with an SMS code (like WhatsApp): phone -> 6-digit code -> name for new numbers; only a hash of the code,
      10 min, 5 tries, 1 a minute / 5 an hour per number; same answers whether or not a number is registered;
      support can't use SMS alone; privacy download/closure confirmed with a fresh code; demo mode shows the code;
      sessions 30 days for members, 30 min idle for staff; `npm run test:signin` (12 checks)
- [x] Seller dashboard redesign: greeting and shop status, "To do now" first (orders that need the seller, cash to
      confirm, low stock by name, or "All caught up"), large action tiles, numbers as plain sentences with what they
      mean, orders waiting on others and order history separately
- [x] Photos: up to 5 per product (main photo, remove), shop cover photo and "about" text; shrunk on the phone
      (1200 px WebP, ~100-200 KB, location data dropped); file type checked from its first bytes; Cloudinary when
      CLOUDINARY_URL is set, otherwise kept in the database; public shop page (/shop/:id, no phone or address) and
      product page (/product/:id) with gallery; `npm run test:photos` (9 checks)
- [x] Automatic database updates: server/db/migrations.sql runs at every start (IF NOT EXISTS), so new features
      reach the hosted database without a reset
- [x] Reviews: 1-5 stars and an optional comment, only for your own COMPLETED order, once, within 30 days;
      first name only in public; seller replies once; support-hidden reviews don't count; shop rating on shop and
      product pages; in "download my data"
- [x] Entrepreneur of the Month: published formula over 30 days (50% completed orders vs the best shop, 30% rating,
      20% acceptance; at least 3 orders and 3 reviews; on-site orders only), card on Home with "How is this
      chosen?", badge on the shop page; demo order history with reviews in English, Setswana and Afrikaans;
      `npm run test:reviews` (10 checks)
- [x] WhatsApp: "Share on WhatsApp" on product and shop pages and the seller dashboard; optional seller WhatsApp
      number for "Ask the seller" / "Chat on WhatsApp" (messages always carry a link back to the site); link previews
      (Open Graph tags written by the server) so shared links show the photo, name and price
- [x] Collection only for heavy or live items (bricks, sand, livestock): tag on cards, note on the product page,
      delivery disabled in the cart, refused by the server
- [x] QR handover: the customer's 6-digit code is also shown as a QR code; seller (pickup) and courier (delivery)
      can scan it with the camera (BarcodeDetector; typing still works)
- [x] Barcodes: optional per product (unique per shop), scan to fill in, and "scan a barcode" in the product list
      to jump to that product; `npm run test:sharing` (8 checks)
- [ ] Deploy (needs the student's Render and Neon accounts), reviewed translations, remaining tables
