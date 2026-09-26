-- KurumanMarketPlace core schema (MVP)
-- Money is always stored as whole cents (INTEGER), never as decimals.
-- WARNING: running this file drops and re-creates all tables (development only).

DROP TABLE IF EXISTS refunds CASCADE;
DROP TABLE IF EXISTS audit_events CASCADE;
DROP TABLE IF EXISTS support_cases CASCADE;
DROP TABLE IF EXISTS courier_profiles CASCADE;
DROP TABLE IF EXISTS payment_events CASCADE;
DROP TABLE IF EXISTS ai_suggestions CASCADE;
DROP TABLE IF EXISTS cash_receipts CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS order_status_history CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS deliveries CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS businesses CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP SEQUENCE IF EXISTS order_number_seq;
DROP FUNCTION IF EXISTS refuse_audit_change CASCADE;

-- ---------------------------------------------------------------
-- People
-- ---------------------------------------------------------------
CREATE TABLE users (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone              VARCHAR(15)  NOT NULL UNIQUE,
  display_name       VARCHAR(80)  NOT NULL,
  password_hash      TEXT         NOT NULL,
  role               VARCHAR(20)  NOT NULL
                     CHECK (role IN ('consumer', 'entrepreneur', 'courier', 'support')),
  preferred_language VARCHAR(2)   NOT NULL DEFAULT 'en'
                     CHECK (preferred_language IN ('en', 'tn', 'af')),
  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  -- Support staff only (spec Table 58 "scope"): what this staff member may do.
  --   approvals  - seller/courier applications, suspensions
  --   payments   - refunds and cash disputes
  --   operations - failed or stuck deliveries
  --   audit      - read the audit log
  staff_scopes       TEXT[]       NOT NULL DEFAULT '{}'
                     CHECK (staff_scopes <@ ARRAY['approvals', 'payments', 'operations', 'audit']),
  -- Two-step sign-in for support (spec FR-21 "MFA"). The authenticator-app secret is stored
  -- ENCRYPTED (lib/secretBox.ts). totp_last_step stops the same code being used twice.
  totp_secret_enc    TEXT,
  totp_pending_enc   TEXT,                        -- set up but not yet confirmed with a code
  totp_last_step     BIGINT,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (role = 'support' OR staff_scopes = '{}')
);

-- Login sessions. The browser only holds a random token in an HttpOnly cookie;
-- we store its SHA-256 hash, so a leaked database cannot be used to log in.
CREATE TABLE sessions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   CHAR(64)    NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,            -- absolute limit (12 hours after login)
  mfa_verified_at TIMESTAMPTZ                   -- support: when THIS session passed the second step
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- One business per entrepreneur for the MVP.
CREATE TABLE businesses (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id       BIGINT       NOT NULL UNIQUE REFERENCES users(id),
  name           VARCHAR(100) NOT NULL,
  description    TEXT,
  area           VARCHAR(80)  NOT NULL,
  pickup_address TEXT         NOT NULL,
  phone          VARCHAR(15)  NOT NULL,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,   -- FALSE = suspended by support: hidden, no new orders
  approved_by    BIGINT       REFERENCES users(id),    -- the support member who approved it (NULL for demo seed)
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Approved couriers (spec Table 61). No licence scans or location history are stored.
CREATE TABLE courier_profiles (
  user_id      BIGINT      PRIMARY KEY REFERENCES users(id),
  vehicle_type VARCHAR(20) NOT NULL CHECK (vehicle_type IN ('on_foot', 'bicycle', 'motorbike', 'car', 'bakkie')),
  area         VARCHAR(80) NOT NULL,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,    -- FALSE = suspended: can't take new jobs
  approved_by  BIGINT      REFERENCES users(id),
  approved_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------
CREATE TABLE categories (
  id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(60) NOT NULL
);

CREATE TABLE products (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id  BIGINT       NOT NULL REFERENCES businesses(id),
  category_id  BIGINT       NOT NULL REFERENCES categories(id),
  name         VARCHAR(100) NOT NULL,
  description  TEXT,
  unit_label   VARCHAR(40)  NOT NULL,           -- e.g. '1 bunch', '1 x 5 kg bag'
  price_cents  INTEGER      NOT NULL CHECK (price_cents > 0),
  stock_qty    INTEGER      NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  reserved_qty INTEGER      NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  image_url    TEXT,
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- You can never reserve more than you have. Available = stock_qty - reserved_qty.
  CHECK (reserved_qty <= stock_qty)
);
CREATE INDEX idx_products_business ON products(business_id);
CREATE INDEX idx_products_category ON products(category_id);

-- ---------------------------------------------------------------
-- Orders (one business per order)
-- ---------------------------------------------------------------
CREATE SEQUENCE order_number_seq;

CREATE TABLE orders (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_number       VARCHAR(20) NOT NULL UNIQUE    -- e.g. KMP-000123
                     DEFAULT ('KMP-' || lpad(nextval('order_number_seq')::text, 6, '0')),
  consumer_id        BIGINT      NOT NULL REFERENCES users(id),
  business_id        BIGINT      NOT NULL REFERENCES businesses(id),
  status             VARCHAR(30) NOT NULL DEFAULT 'pending_acceptance'
                     CHECK (status IN (
                       'pending_acceptance',  -- waiting for the seller to accept
                       'awaiting_payment',    -- accepted, online payment not done yet
                       'confirmed',           -- accepted (cash) or paid (online)
                       'ready',               -- packed, ready for pickup / courier
                       'out_for_delivery',
                       'delivery_failed',     -- courier couldn't hand it over; support decides what next
                       'completed',
                       'declined',
                       'cancelled',
                       'expired'
                     )),
  fulfilment         VARCHAR(10) NOT NULL CHECK (fulfilment IN ('pickup', 'delivery')),
  payment_method     VARCHAR(10) NOT NULL CHECK (payment_method IN ('cash', 'online')),
  subtotal_cents     INTEGER     NOT NULL CHECK (subtotal_cents > 0),
  delivery_fee_cents INTEGER     NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  total_cents        INTEGER     NOT NULL,
  delivery_address   TEXT,
  notes              TEXT,
  accept_by          TIMESTAMPTZ NOT NULL,          -- seller must reply before this
  payment_due_at     TIMESTAMPTZ,                   -- online orders: pay within 15 min of acceptance
  -- The same "Send order" tap arriving twice (e.g. flaky signal) must not create two orders.
  -- The app sends a random key per checkout; request_hash detects a key reused for a different cart.
  idempotency_key    VARCHAR(64) NOT NULL,
  request_hash       CHAR(64)    NOT NULL,
  -- One-time handover code the customer shows when collecting (spec FR-13, section 7.3):
  -- stored hashed, valid 15 minutes, locked after 5 wrong tries.
  handover_code_hash       CHAR(64),
  handover_code_expires_at TIMESTAMPTZ,
  handover_failed_attempts INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (total_cents = subtotal_cents + delivery_fee_cents),
  CHECK (fulfilment = 'pickup' OR delivery_address IS NOT NULL),
  UNIQUE (consumer_id, idempotency_key)
);
CREATE INDEX idx_orders_consumer ON orders(consumer_id);
CREATE INDEX idx_orders_business_status ON orders(business_id, status);

-- Name and price are copied in, so old orders stay correct if the seller edits the product later.
CREATE TABLE order_items (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id         BIGINT       NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       BIGINT       NOT NULL REFERENCES products(id),
  product_name     VARCHAR(100) NOT NULL,
  unit_label       VARCHAR(40)  NOT NULL,
  unit_price_cents INTEGER      NOT NULL CHECK (unit_price_cents > 0),
  quantity         INTEGER      NOT NULL CHECK (quantity > 0),
  line_total_cents INTEGER      NOT NULL,
  CHECK (line_total_cents = unit_price_cents * quantity),
  UNIQUE (order_id, product_id)
);

-- ---------------------------------------------------------------
-- Delivery and payment
-- ---------------------------------------------------------------
CREATE TABLE deliveries (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id              BIGINT      NOT NULL UNIQUE REFERENCES orders(id),
  courier_id            BIGINT      REFERENCES users(id),      -- NULL until a courier claims it
  status                VARCHAR(20) NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'claimed', 'collected', 'delivered', 'failed', 'cancelled')),
  -- The seller confirms handing the goods to THIS courier; collection needs it (spec FR-15).
  released_to_courier_id BIGINT     REFERENCES users(id),
  released_at           TIMESTAMPTZ,
  fee_cents             INTEGER     NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  cash_to_collect_cents INTEGER     NOT NULL DEFAULT 0 CHECK (cash_to_collect_cents >= 0),
  cash_remitted         BOOLEAN     NOT NULL DEFAULT FALSE,
  claimed_at            TIMESTAMPTZ,
  collected_at          TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  -- Failed handover (spec FR-15): why, and when the goods got back to the seller.
  failed_reason         VARCHAR(40),
  failed_at             TIMESTAMPTZ,
  returned_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Every job past "open" has a courier - except one cancelled before anyone took it.
  CHECK (status IN ('open', 'cancelled') OR courier_id IS NOT NULL)
);
CREATE INDEX idx_deliveries_status ON deliveries(status);

-- One row per online payment ATTEMPT (spec: payment_attempts). Cash is in cash_receipts.
--   pending   - customer was sent to Payfast; nothing verified yet
--   paid      - verified capture, applied to the order (at most one per order)
--   unapplied - verified capture that could NOT be applied (order expired, or already paid):
--               the money is real and must be refunded - never silently ignored (spec BR-08)
--   failed    - Payfast reported the payment failed
CREATE TABLE payments (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id           BIGINT      NOT NULL REFERENCES orders(id),
  provider           VARCHAR(20) NOT NULL DEFAULT 'payfast',
  attempt_reference  VARCHAR(40) NOT NULL UNIQUE,  -- our m_payment_id sent to Payfast
  status             VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'paid', 'unapplied', 'failed', 'refunded')),
  amount_cents       INTEGER     NOT NULL CHECK (amount_cents > 0),
  provider_reference VARCHAR(100) UNIQUE,          -- Payfast pf_payment_id; UNIQUE blocks duplicates
  verified_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most ONE applied (paid) capture per order, enforced by the database itself.
CREATE UNIQUE INDEX one_applied_payment_per_order ON payments(order_id) WHERE status = 'paid';

-- Every payment notification we receive, kept as evidence - including rejected/forged ones.
-- Only references, amounts and outcomes are stored: no names, emails or card data.
CREATE TABLE payment_events (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider           VARCHAR(20)  NOT NULL,
  attempt_reference  VARCHAR(40),
  provider_reference VARCHAR(100),
  payment_status     VARCHAR(20),
  amount_cents       INTEGER,
  outcome            VARCHAR(40)  NOT NULL,   -- e.g. applied, duplicate, rejected_signature
  received_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Physical cash, kept separate from digital payments (spec BR-11).
-- collected = what the collector received; remitted = what reached the business.
-- For pickup the seller collects directly, so both are equal at once.
CREATE TABLE cash_receipts (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id        BIGINT      NOT NULL UNIQUE REFERENCES orders(id),
  collected_by    BIGINT      NOT NULL REFERENCES users(id),
  -- collected: courier holds it; remitted: business confirmed receiving it all;
  -- disputed: business received a different amount - stays visible, never written off.
  status          VARCHAR(10) NOT NULL DEFAULT 'collected'
                  CHECK (status IN ('collected', 'remitted', 'disputed')),
  acknowledged_by BIGINT      REFERENCES users(id),
  collected_cents INTEGER     NOT NULL CHECK (collected_cents >= 0),
  remitted_cents  INTEGER     NOT NULL DEFAULT 0 CHECK (remitted_cents >= 0),
  collected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  remitted_at     TIMESTAMPTZ,
  CHECK (remitted_cents <= collected_cents)
);

-- AI category suggestions (spec 8.2 "Retention", 8.4 human control).
-- Stores what the model suggested and what the seller finally chose - never the listing text.
-- Proposed retention: 30 days (to be enforced by a clean-up job).
CREATE TABLE ai_suggestions (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id        BIGINT       NOT NULL REFERENCES businesses(id),
  model_version      VARCHAR(40)  NOT NULL,
  locale             VARCHAR(2)   NOT NULL,
  suggested_category VARCHAR(40),                 -- NULL when the model abstained
  score              NUMERIC(4,3),
  abstain_reason     VARCHAR(40),
  chosen_category    VARCHAR(40),                 -- filled when the product is saved
  outcome            VARCHAR(12)
                     CHECK (outcome IN ('accepted', 'overridden', 'manual')),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Every status change is recorded: who, when, from what, to what.
CREATE TABLE order_status_history (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    BIGINT      NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status VARCHAR(30),
  to_status   VARCHAR(30) NOT NULL,
  changed_by  BIGINT      REFERENCES users(id),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_history_order ON order_status_history(order_id);
CREATE INDEX idx_history_to_status ON order_status_history(to_status, created_at);

-- ---------------------------------------------------------------
-- Restricted support (spec FR-21, FR-22, Tables 77-78)
-- ---------------------------------------------------------------

-- One row per thing a person on the support team must look at and decide.
-- details holds only what the decision needs (e.g. the business name on an application).
CREATE TABLE support_cases (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_type         VARCHAR(24) NOT NULL
                    CHECK (case_type IN (
                      'seller_application', 'courier_application',
                      'refund',        -- verified money that must go back (late/second payment, cancelled paid order)
                      'cash_dispute',  -- a seller received a different amount of cash than was collected
                      'fulfilment',    -- delivery failed, or no courier took the job in time (BR-10)
                      'order_problem'  -- the customer reported a problem after receiving the order (FR-16)
                    )),
  status            VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  requester_id      BIGINT      NOT NULL REFERENCES users(id),
  order_id          BIGINT      REFERENCES orders(id),
  details           JSONB       NOT NULL DEFAULT '{}',
  resolution        VARCHAR(20),                  -- e.g. approved, rejected
  resolution_reason TEXT,                         -- shown to the requester where relevant
  resolved_by       BIGINT      REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at         TIMESTAMPTZ,
  CHECK ((status = 'open') = (closed_at IS NULL))
);
CREATE INDEX idx_cases_open ON support_cases(case_type) WHERE status = 'open';
-- At most one open case of each kind per order: a second problem joins the open case.
CREATE UNIQUE INDEX one_open_case_per_order ON support_cases(order_id, case_type)
  WHERE status = 'open' AND order_id IS NOT NULL;
-- A person can only have one application waiting at a time.
CREATE UNIQUE INDEX one_open_application_per_user ON support_cases(requester_id)
  WHERE status = 'open' AND case_type IN ('seller_application', 'courier_application');

-- Who did what, when and why. Identifiers and outcomes only - never passphrases, codes,
-- addresses or card data (spec FR-22).
CREATE TABLE audit_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id BIGINT       REFERENCES users(id),   -- NULL for automatic actions
  action        VARCHAR(60)  NOT NULL,              -- e.g. application.approve
  resource_type VARCHAR(40)  NOT NULL,              -- e.g. support_case
  resource_id   VARCHAR(100) NOT NULL,
  outcome       VARCHAR(20)  NOT NULL,              -- success, refused, failed
  reason        TEXT,
  changes       JSONB,
  occurred_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_time ON audit_events(occurred_at DESC);
CREATE INDEX idx_audit_resource ON audit_events(resource_type, resource_id);

-- The audit log is append-only: the database itself refuses to change or delete a row,
-- whatever the application code tries (spec: "application roles cannot rewrite audit history").
CREATE FUNCTION refuse_audit_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update_or_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION refuse_audit_change();
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_audit_change();

-- Money going back to a customer (spec Table 72, TX-04). A refund is its own record: it never
-- edits or deletes the payment it refunds, so the history of what happened stays complete.
--   pending   - support has started it and the amount is reserved
--   succeeded - done, with the provider's refund reference as evidence
--   failed    - didn't happen; the amount can be refunded again
-- purpose: unapplied_capture = money that was never applied to the order (late/second payment);
--          order_refund      = money for an order that was applied and is being given back.
CREATE TABLE refunds (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id           BIGINT       NOT NULL REFERENCES orders(id),
  payment_id         BIGINT       NOT NULL REFERENCES payments(id),
  purpose            VARCHAR(20)  NOT NULL CHECK (purpose IN ('unapplied_capture', 'order_refund')),
  amount_cents       INTEGER      NOT NULL CHECK (amount_cents > 0),
  status             VARCHAR(10)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  provider_reference VARCHAR(100),
  reason             TEXT         NOT NULL,
  requested_by       BIGINT       NOT NULL REFERENCES users(id),
  completed_by       BIGINT       REFERENCES users(id),
  requested_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ,
  -- "Succeeded" needs evidence: nobody can mark money as returned without the provider's reference.
  CHECK (status <> 'succeeded' OR provider_reference IS NOT NULL),
  CHECK ((status = 'pending') = (completed_at IS NULL))
);
CREATE INDEX idx_refunds_payment ON refunds(payment_id);
