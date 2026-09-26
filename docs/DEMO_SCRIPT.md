# KurumanMarketPlace — Presentation demo script

About 15–20 minutes. Each step says **what to click**, **what to say**, and which part of the
specification it proves. Practise it once end to end the day before.

---

## 0. Before you present (10 minutes, do this first)

Open VS Code in `Kuruman_MarketPlace`. You need **four terminals** (the **+** button in the terminal panel).
Check each prompt ends in `Kuruman_MarketPlace>` before typing.

**Terminal 1 — reset the demo data** (clean order numbers from KMP-000001):
```
cd server
```
```
npm run db:setup
```
```
npm run db:seed
```

**Terminal 1 again — start the API:**
```
npm run dev
```

**Terminal 2 — start the website:**
```
cd client
```
```
npm run dev
```

**Terminal 3 — start the AI service:**
```
cd ai
```
```
python service.py
```

**Terminal 4** — keep free for running the tests live (section 8).

**Browser windows** (sign in to each before you start):

| Window | Who | Phone | How |
|---|---|---|---|
| A | Customer Thato | 071 000 0001 | Normal window |
| B | Seller Kgomotso | 071 000 0002 | Private / InPrivate window |
| C | Courier Pieter | 071 000 0003 | A different browser (e.g. Chrome if A is Edge), or your phone |

Passphrase for all: `Kuruman Oasis 2026`

Tip: press **F12 → device toolbar** (phone icon) and pick a phone size, so it looks like the real thing.

---

## 1. The idea (1 minute, no clicking)

**Say:** "Small businesses in Kuruman sell mostly by WhatsApp and word of mouth. KurumanMarketPlace
is a mobile-first web app where local customers order from them, pay cash or online, and collect
or get it delivered by a local courier. It's for the people, by the people."

"Three public roles: customer, seller, courier. Support staff are a separate restricted role —
nobody can sign up as support."

---

## 2. Browse and cart (Window A, 2 minutes)

1. Show the **Home** screen. Point out the dune ribbon, the Mokala tree, the oasis green.
   **Say:** "The look is 'Oasis of the Kalahari'. Decorative images stay away from prices and buttons,
   and product photos must be the seller's own."
2. Tap a **category chip**, then type in **search** ("bread").
3. Tap **+** on Spinach twice, then **+** on the Beaded bracelet (a different seller).
   The **"Start a new cart?"** box appears.
   **Say:** "Business rule 1: one seller per order. We never silently empty the cart — the customer decides." (FR-07)
4. Tap **Keep my cart**.
5. Open **Cart**. Point out **Not submitted** and the saved time.
   **Say:** "Until it's sent, this is only a draft on the phone. The server re-checks prices and stock when the cart opens." (BR-05, FR-08)
6. Choose **Delivery**, type an address, keep **Cash**. Total is R75.00 (2 × R25 + R25 delivery) — the spec's own example.
   **Say:** "Money is whole cents everywhere — 7500, not 75.00 — so there are no rounding errors." (BR-03)
7. Tap **Send order to seller**.
   **Say:** "In one database transaction the server locks the product rows, checks stock, reserves it,
   and writes the order, its items and its first history row. If anything fails, nothing is saved." (TX-01)

---

## 3. Seller decides (Window B, 2 minutes)

1. Tap **My shop**. The order is under **Waiting for you** with the minutes left.
   **Say:** "The seller has 30 minutes. If they don't answer, the order expires and the stock is released automatically." (BR-06)
2. Tap **Decline** to show the reasons, then **Back**. **Say:** "A decline needs a reason, which the customer sees."
3. Tap **Accept**, then **Mark as ready**.
   **Say:** "Seller first, payment second. Because it's a delivery order, marking it ready opens a courier job." (BR-07, BR-09)
4. Point at the KPI tiles. **Say:** "These follow the spec's KPI definitions. It never says 'profit' — it's product value only."

---

## 4. Courier delivers (Window C, then B and A — 3 minutes)

1. Window C → **Jobs**. **Say:** "Before taking a job, the courier sees only the area and the fee — not the customer's name or address." (BR-13)
2. Tap **Take this job**. **Say:** "If two couriers tap at the same moment, exactly one wins — it's a single
   conditional update: `UPDATE ... WHERE status = 'open'`." (TX-03, FR-14)
3. Window B → refresh → **Hand over to Pieter**. **Say:** "Collection needs the seller's confirmation." (FR-15)
4. Window C → refresh → **I've collected the order**. The address now appears.
   **Say:** "Now the stock is consumed — exactly once."
5. Window A → **Orders** → **Show delivery code**. Read the 6 digits aloud.
6. Window C → type the code → **Complete delivery**.
   **Say:** "The code is stored hashed, lasts 15 minutes and locks after 5 wrong tries." (FR-13, 7.3)
7. Window B → refresh → **Cash from couriers** → **Received R75.00**.
   **Say:** "Collecting cash and handing it to the seller are separate events. If the amount is different it's marked
   *disputed* and stays visible — nothing is written off." (BR-11)

---

## 5. The AI part (Window B, 2 minutes)

1. **Your products and stock → + Add a product.**
2. Name: `Beaded anklet`, description: `Handmade anklet in Kalahari colours`, language English.
3. Tap **✦ Suggest a category (AI)** → *Crafts & gifts*, with its confidence.
   **Say:** "This is a genuinely trained model — TF-IDF features and logistic regression — not keyword rules.
   It's advisory: the seller must tap *Use this category* or pick another. The product is saved with the seller's choice." (FR-19, BR-14)
4. Try a vague name like `Special item` → it **abstains**. **Say:** "When unsure, it says so rather than guess."
5. Optional: stop the AI service (Ctrl + C in terminal 3) and tap Suggest again → "not available", the form still works.
   **Say:** "The marketplace never depends on the AI being up."
6. Open `ai/reports/evaluation.md` and show the table (see section 9 for what to say about the numbers).

---

## 6. Offline (Window A, 1 minute)

1. F12 → **Network** tab → set **Offline**. Reload.
2. The app still opens, with the banner and **"Saved copy from …"**.
   **Say:** "It's a PWA: installable, and the public catalogue works offline, labelled with its age.
   Private data — orders, addresses, payments — is never stored on the phone. Orders can only be sent online." (5.3)
3. Set Network back to **No throttling**.

---

## 7. Online payment (1 minute — explain, and show the tests)

**Say:** "Online payment uses Payfast in sandbox mode. After the seller accepts, the customer is sent to Payfast's own page —
we never see card details. Coming back from Payfast does *not* mark the order paid. Only Payfast's signed server
notification does, after we check the signature, merchant, amount, source and Payfast's own validation. A repeated
notification is ignored, and money that arrives after an order expired is recorded for a refund — it never revives the order."
(5.5, TX-02, BR-08)

Then show it live (your own sandbox account is set up in `server/.env`):

1. Window A: add an item, choose **Pay online**, send. Window B: **Accept**.
2. Window A → **Orders** → **Pay with Payfast** → Payfast's sandbox page → **Complete Payment**.
3. You're sent back and the order still says **Accepted – pay now**.
   **Say:** "Payfast took the payment, but our server hasn't received Payfast's signed notification — it can't reach
   my laptop. So the order is correctly *not* marked paid. Coming back from Payfast is not proof. The next test
   shows what happens when notifications do arrive." (BR-07)

Then run the proof (section 8, `test:payfast`).

---

## 8. Automated evidence (Terminal 4, 1 minute)

```
cd server
```
```
npm run test:kpi
```
→ reproduces the spec's KPI example (Table 33) exactly: **TC-18 PASS**.

```
npm run test:payfast
```
→ 13 payment checks: forged, wrong amount, wrong merchant, duplicate, late payment… **TC-11: 13 checks PASSED**.

(`test:payfast` adds test orders — reset the data afterwards if you'll demo again.)

---

## 9. What to say honestly (before they ask)

- **AI results:** "The model meets 5 of the 6 targets in section 8.3. Overall macro-F1 is 0.71 against a target of 0.75,
  and the 95% interval includes 0.75. The dataset is 240 products I authored, and the Setswana and Afrikaans still need
  fluent-speaker review, so the next step is better data — not more tuning, which would just be fitting the test set.
  The first version scored 0.66; I changed the tuning method to grouped cross-validation and I disclose that in the model card."
- **Languages:** "Phase 1 uses Google Translate. Payment and legal wording must be reviewed by fluent speakers before real use (NFR-09)."
- **Payments:** "Sandbox only. The design doesn't claim one merchant account can collect for every seller in production."
- **Scope still to build:** support console, refunds and returns, failed-delivery handling, privacy requests, and the remaining tables.
- **Passwords:** bcrypt now; the spec's Argon2id is the documented upgrade.

## 10. Likely questions

| Question | Answer |
|---|---|
| How do you stop two people buying the last item? | Row locks (`SELECT … FOR UPDATE`) in product-id order inside one transaction, plus a database CHECK that reserved stock can't exceed stock. I tested two simultaneous orders — one wins. |
| What if the customer taps "Send" twice? | Every checkout has an idempotency key; the same key returns the same order, a different cart with the same key is refused. |
| Can a customer make themselves a seller? | No. Registration always creates a consumer; the role comes from the database via the session, never from the browser. |
| How are logins kept safe? | Passphrases hashed with bcrypt; a random session token in an HttpOnly, SameSite cookie; only its SHA-256 hash is stored; 30-min idle and 12-hour limits; rate-limited login; the same error for a wrong number or wrong passphrase. |
| Why not trust the Payfast return page? | Anyone can visit a return URL. Only the verified server-to-server notification counts. |
| Is the AI deciding anything? | No. It only suggests; the seller confirms every time, and we record whether they accepted or overrode it. |
| What happens offline? | Browse the saved catalogue and build a cart draft; anything that changes money, stock or status needs a connection. |

---

## Payfast: your own sandbox account (done — kept here for reference)

1. Sign up free at **https://sandbox.payfast.co.za**.
2. In the sandbox dashboard copy your **Merchant ID** and **Merchant Key**, and set a **passphrase** (Settings → Developer settings).
3. Add to `server/.env`:
   ```
   PAYFAST_SANDBOX=true
   PAYFAST_MERCHANT_ID=your id
   PAYFAST_MERCHANT_KEY=your key
   PAYFAST_PASSPHRASE=your passphrase
   ```
4. Restart the API. "Pay online" is now available at checkout.

Payfast's notification can't reach `localhost`. To see a real notification arrive, you need a public tunnel address
(for example Cloudflare Tunnel or ngrok) in `PAYFAST_NOTIFY_URL`, plus `TRUST_PROXY=true`. Without it, the customer can
pay on Payfast, but the order correctly stays "waiting for payment" — which is itself a good demonstration of rule BR-07.
