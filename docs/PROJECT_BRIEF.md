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
| 071 000 0101–16 | Mpho, Kagiso, Refilwe and 13 more | consumers who wrote the demo reviews (96 reviews in English, Setswana and Afrikaans) |
| 071 000 0099 | Walk-in customers | places the SYNTHETIC 12-week sales history of every shop (for the forecasts and numbers) |
| 071 000 0014 | Mma Kefilwe's stall phone | basic phone: gets orders by SMS (open /demo/phone) — not a login |
| 071 000 0015 | Tebogo | entrepreneur: helper who manages Mma Kefilwe's market stall |

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
- [x] Seller delivers: shops with their own truck or bakkie switch on own delivery (their fee, vehicle and areas);
      a third order type `seller_delivery`: never on the courier board, stock used when it leaves, completed at the
      door with the customer's code or QR; heavy items can then be delivered by the seller instead of collect only
- [x] Market stalls: apply "on behalf of a market stall" (a helper manages the listing); stall location, days and
      hours with "At the stall now"; reserve-and-collect only (server enforced)
- [x] Orders by SMS (any business can switch it on; stalls by default): new order SMS to the business phone; reply
      1 = accept (a stall's cash pickup is ready at once), 2 = sold out, the customer's 6-digit code = handed over and
      completed; only the business's own phone counts; every change in the order history; gateway webhook
      /api/sms/inbound with a secret token; order SMS kept 30 days; demo basic-phone page /demo/phone (demo mode
      only); `npm run test:stalls` (9 checks)
- [x] Tier 2 AI (all our own models, ai/README.md): reviews-v2 (260 reviews x 3 languages; sentiment macro-F1 0.691 vs
      keyword 0.308 and majority 0.204; themes micro-F1 0.669 vs keyword 0.601; new "good quality" theme) shown as
      "Customers mention" on shop pages and per review for sellers; screening-v2 (160 texts x 3 languages; precision
      0.912, recall 0.795, F1 0.849 vs keyword F1 0.526; recall target 0.90 met in CV but not on test - Setswana and
      Afrikaans 0.77) feeds support's "Flagged" tab, where
      a person decides with a reason (audit log), nothing hidden automatically; forecast-v1 (Poisson regression per
      product, 24% lower MAE than the best baseline on a synthetic backtest) as "Next 7 days" on the seller dashboard;
      multilingual search = hand-made glossary + pg_trgm (not ML). Background AI worker; site works if the AI is down;
      `npm run test:ai` (9 checks, fake AI service)
- [x] Voice notes: sellers record up to 60 s per product in the browser (any language); audio checked by its first
      bytes; customers play it on the product page
- [x] Kuruman Business Directory (/directory): local services with Call/WhatsApp; anyone signed in suggests a listing
      with the owner's consent; support approves/rejects with a reason (audit log); demo listings
- [x] WhatsApp Channel helper: support's "WhatsApp post" tab builds the weekly post (Entrepreneur of the Month, new
      shops, popular products, stalls, new services), every line linking to the site
- [x] Real SMS through BulkSMS (token in Render; demo numbers never texted; replies via webhook, accepted as a list)
- [x] Free calls over data (Twilio): server decides who may call (order participants; shops that switch calls on),
      the browser never sees a number, Twilio's signature checked, each call id used once, 5-minute and 10-a-day
      limits, calls kept 30 days; `npm run test:extras` (12 checks)
- [x] Seller verification (like Payfast's): applying to sell needs an email, a copy of the ID document (photo or
      PDF, checked by its first bytes), and ticking the seller terms (/seller-terms) and the POPIA privacy notice -
      the versions agreed to are saved. The ID copy is stored encrypted (AES-256-GCM), only approvers can open it,
      every opening is audited, and it is deleted 30 days after the decision. The admin gets an email (Resend) with
      a link to the console - never the ID itself. `test:support` (21 checks), `test:extras` (14)
- [x] Help tickets (/help), like a support centre: anyone signed in opens a ticket (topic, title, message) and
      follows it on the site - number, status (waiting for support / support replied / closed), the conversation.
      Support answers in the console's Tickets tab (every staff member); the person gets an in-app notification and
      an SMS with the link. Only their own tickets; support sees name and role, not the phone number. Max 5 open per
      person; deleted 12 months after closing; included in "download my data". Applicants also get emails (received,
      support's questions, decision) with replies to the admin's inbox, kept as a trail. `test:support` (27 checks)
- [x] Legal pages and acceptance, like Payfast: Terms of use (/terms), Returns & refunds (/returns: ECTA s44 7-day
      cooling-off with the s42 exclusions, CPA s55-56 six months for faulty goods, wrong items, refunds via Payfast
      or cash), the privacy notice and seller terms; the business details ECTA s43 requires in one place
      (client/src/lib/legal.ts). Every signed-in person accepts the current version once ("I agree to the above" ->
      Confirm); the version and time are saved on the account and in the audit log, and the box returns when the
      terms change (POLICY.termsVersion). Linked in the footer and at checkout. `test:extras` (15 checks)
- [x] Courier verification, like sellers': email, ID document, police clearance certificate (SAPS) and - for a
      motorbike, car or bakkie - a driver's licence; courier terms (/courier-terms) and the privacy notice ticked.
      Same protection (encrypted, approvers only, every opening audited, deleted 30 days after the decision);
      support opens each document separately; a wrong document is replaced on the Profile. `test:support` (28 checks)
- [x] Documents still owed by couriers: an applicant may send proof of applying for police clearance and then the
      certificate within 30 days of approval; couriers approved before checks began send all their documents within
      14 days. Sent from the Deliveries page, checked by support (Verified / Reject with a reason, notified); once
      overdue the courier can finish their jobs but take no new ones. `test:support` (30 checks)
- [x] Delivering to a map pin: at checkout the customer may drop a pin (phone GPS, or a tap on the map; must be
      within 40 km of Kuruman). The courier who takes the job, or a shop delivering itself while it's on its way,
      gets a map and Google Maps directions (to the pin, else the address). Leaflet + OpenStreetMap (no key, no
      cost), loaded only on pages with a map. The pin is erased with the address after 30 days. `test:tracking`
- [x] Live tracking: while a courier has a delivery on the go their phone shares its position (location must
      be on to take a job; only the latest position is kept, deleted when they finish). The customer's
      /orders/:id/track page shows the steps, a map with them and the courier, "8.3 km away · about 22 min"
      (straight line x 1.3 at the vehicle's town speed), the delivery code, and "Share where I am" if they had
      no pin. Notifications and the "on the way" SMS link to it. `test:tracking` (16 checks)
- [x] Customer <-> courier chat while a courier has the order (quick replies, unread badge, a notification only
      if not seen yet; the courier loses it when the delivery ends, the customer can still read it; deleted after
      30 days). "I'm outside" = a chat message + an SMS to the customer (at most every 2 min). Free calls both
      ways once the order is on its way (Twilio, existing rules). Privacy notice and courier terms updated.
- [x] Directions in the app (no maps app needed): "🧭 Directions in the app" draws the road route to the
      customer's pin on the map, shows the next turn in big letters ("➡️ Turn right onto Tsenin Street (R31) –
      in 300 m"), the km and minutes left, and "You've arrived" at the pin. The route is worked out again every
      50 m (at most every 10 s) by our server through the free OpenStreetMap routing service (FOSSGIS OSRM: only
      two map points are sent, never a name; one request per courier per 3 s; a straight line if it's down).
      The "Maps app" buttons open Apple Maps on an iPhone and Google Maps on Android, so nothing needs
      installing. `test:tracking` (22 checks)
- [x] Markets with a Kuruman story (5 Nov): four markets keep their plain names, with a photo of the person
      or place they honour behind them, and tell the story when opened. Water & ice: Leitlho, the Eye of
      Kuruman (about 20 million litres a day). Doctors & healers: in honour of Credo Mutwa (1921–2020), who
      spent his last years in Kuruman. Books & lessons: the Moffat Mission (the Setswana Bible, 1857).
      Street food & caravans: Wonderwerk Cave (signs of fire about a million years old; drawn, as no photo
      has a free licence). Water and books are new categories (db/migrations.sql); doctors and healers are a
      Business Directory category, because the seller terms don't allow medicines to be sold. Photos are
      from Wikimedia Commons (CC BY 2.0 / CC BY-SA), credited on each market. Before a real launch: ask Credo
      Mutwa's family whether they agree to his photo and name being used.
- [x] Real photos on every market (5 Nov): our own from Kuruman (street food: the caravan park sign, and a
      row of food caravans and take-aways when the market is opened; clothing: traditional attire and a
      tailor's dresses; personal care: a salon) and free-licence photos from Wikimedia Commons for the rest
      (credited when the market is opened). The people in our photos agreed to be photographed (POPIA); a
      muthi shop is shown under Doctors & healers. The election poster was cropped out, and location data was stripped from our photos. The drawings stay
      underneath as the offline fallback; photos are cached once seen, not downloaded upfront.
- [x] Cleaner layout (5 Nov): a ☰ menu at the top left (Home, Cart, My orders, My shop / Deliveries,
      Notifications, Profile, Directory, Help) replaces the bottom bar; the cart stays at the top right; the
      footer (terms, returns, privacy, help, photo credits) is on every page. Home opens with a slideshow of
      Kuruman's markets (our photos, SMME Village first; a pause button, still for "reduce motion", the next
      photo fetched only when its turn comes). Products without a seller photo show a photo of their kind (no
      label, the user's choice) until the seller adds their own (lib/examplePhotos.ts; credits on /photo-credits).
- [x] SMS in English, Setswana or Afrikaans: each person gets SMS in their account's language (set by the
      language button; a new account takes the site's language), a stall's SMS in the owner's language. All
      texts in server/src/lib/smsText.ts; Setswana and Afrikaans are DRAFTS until checked by fluent speakers.
      `test:sms` checks every text fits in one SMS in the basic GSM-7 alphabet (no ê/ë/ô/š, which would make
      it Unicode and cost 2-3 SMS). (7 checks)
- [ ] Deploy (needs the student's Render and Neon accounts), reviewed translations, remaining tables
