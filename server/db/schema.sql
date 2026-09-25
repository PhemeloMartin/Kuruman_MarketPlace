-- KurumanMarketPlace core schema (MVP)
-- Money is always stored as whole cents (INTEGER), never as decimals.
-- WARNING: running this file drops and re-creates all tables (development only).

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
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Login sessions. The browser only holds a random token in an HttpOnly cookie;
-- we store its SHA-256 hash, so a leaked database cannot be used to log in.
CREATE TABLE sessions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   CHAR(64)    NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL             -- absolute limit (12 hours after login)
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
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
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
                        CHECK (status IN ('open', 'claimed', 'collected', 'delivered', 'failed')),
  handover_code_hash    TEXT,                                  -- the customer's code, hashed
  fee_cents             INTEGER     NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  cash_to_collect_cents INTEGER     NOT NULL DEFAULT 0 CHECK (cash_to_collect_cents >= 0),
  cash_remitted         BOOLEAN     NOT NULL DEFAULT FALSE,
  claimed_at            TIMESTAMPTZ,
  collected_at          TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'open' OR courier_id IS NOT NULL)
);
CREATE INDEX idx_deliveries_status ON deliveries(status);

CREATE TABLE payments (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id           BIGINT      NOT NULL REFERENCES orders(id),
  method             VARCHAR(10) NOT NULL CHECK (method IN ('cash', 'online')),
  status             VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  amount_cents       INTEGER     NOT NULL CHECK (amount_cents > 0),
  provider_reference VARCHAR(100) UNIQUE,   -- Payfast reference; UNIQUE blocks duplicate notifications
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Physical cash, kept separate from digital payments (spec BR-11).
-- collected = what the collector received; remitted = what reached the business.
-- For pickup the seller collects directly, so both are equal at once.
CREATE TABLE cash_receipts (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id        BIGINT      NOT NULL UNIQUE REFERENCES orders(id),
  collected_by    BIGINT      NOT NULL REFERENCES users(id),
  collected_cents INTEGER     NOT NULL CHECK (collected_cents >= 0),
  remitted_cents  INTEGER     NOT NULL DEFAULT 0 CHECK (remitted_cents >= 0),
  collected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  remitted_at     TIMESTAMPTZ,
  CHECK (remitted_cents <= collected_cents)
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
