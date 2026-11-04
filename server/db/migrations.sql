-- Changes made AFTER the hosted database was first created from schema.sql.
--
-- The server runs this whole file every time it starts (src/lib/migrate.ts), and `npm run db:setup`
-- runs it right after schema.sql. So every statement must be safe to run again and again
-- (IF NOT EXISTS ...): the first run adds what's new, later runs change nothing, and existing data
-- is kept. This way a new feature reaches the hosted database without wiping it.
--
-- New tables here must also be added to the DROP list at the top of schema.sql.

-- Only one server at a time may run this (held until the end of this file's transaction).
SELECT pg_advisory_xact_lock(424242);

-- 2026-10-25: photos for products and a cover photo for each shop.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS cover_photo_url TEXT;

-- Where each photo is. Stored on Cloudinary (an image service) when it's configured; otherwise
-- the image itself is kept in this table (data) and served by GET /api/photos/:id.
-- products.image_url and businesses.cover_photo_url hold the URL that pages show.
CREATE TABLE IF NOT EXISTS photos (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id  BIGINT      NOT NULL REFERENCES businesses(id),
  product_id   BIGINT      REFERENCES products(id) ON DELETE CASCADE,  -- NULL = the shop's cover photo
  storage      VARCHAR(12) NOT NULL CHECK (storage IN ('cloudinary', 'database')),
  url          TEXT,                                -- set right after the row is created
  storage_key  TEXT,                                -- Cloudinary's id for the image, to delete it later
  data         BYTEA,                               -- the image itself, only when storage = 'database'
  content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes        INTEGER     NOT NULL CHECK (bytes > 0),
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((storage = 'database') = (data IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_photos_product ON photos(product_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_photos_business ON photos(business_id);

-- 2026-10-26: reviews. Only a customer whose order was COMPLETED can review it, once per order,
-- so every review comes from a real purchase on the site. The seller may reply once.
CREATE TABLE IF NOT EXISTS reviews (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id          BIGINT      NOT NULL UNIQUE REFERENCES orders(id),
  business_id       BIGINT      NOT NULL REFERENCES businesses(id),
  consumer_id       BIGINT      NOT NULL REFERENCES users(id),
  rating            SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment           TEXT        CHECK (char_length(comment) <= 500),
  seller_reply      TEXT        CHECK (char_length(seller_reply) <= 500),
  seller_replied_at TIMESTAMPTZ,
  -- Support can hide a review that breaks the rules (insults, someone's phone number...); kept, not deleted.
  hidden_at         TIMESTAMPTZ,
  hidden_reason     TEXT,
  -- Filled in by the review AI (sentiment and themes), never by people.
  sentiment         VARCHAR(10) CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  themes            TEXT[]      NOT NULL DEFAULT '{}',
  ai_model_version  VARCHAR(40),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reviews_business ON reviews(business_id, created_at DESC);

-- 2026-10-26: WhatsApp, heavy items and barcodes.
-- A business WhatsApp number the SELLER chooses to show for "Chat on WhatsApp" (empty = no button).
-- Customers' numbers are never shown to sellers this way.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS whatsapp_phone VARCHAR(15);
-- Too big or alive for a courier (bricks, sand, livestock): the customer must collect it.
ALTER TABLE products ADD COLUMN IF NOT EXISTS collection_only BOOLEAN NOT NULL DEFAULT FALSE;
-- The barcode on the packet, so the seller can scan it to find the product and update stock.
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(32);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(business_id, barcode) WHERE barcode IS NOT NULL;

-- 2026-10-26: shops with their own truck or bakkie deliver heavy items themselves ("seller delivers").
-- NULL fee = the shop doesn't deliver itself.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS own_delivery_fee_cents INTEGER CHECK (own_delivery_fee_cents >= 0);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS own_delivery_note VARCHAR(200);
-- A third way to get an order: 'seller_delivery' (the shop's own vehicle, the shop's own fee).
ALTER TABLE orders ALTER COLUMN fulfilment TYPE VARCHAR(20);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_fulfilment_check;
ALTER TABLE orders ADD CONSTRAINT orders_fulfilment_check CHECK (fulfilment IN ('pickup', 'delivery', 'seller_delivery'));

-- 2026-10-26: market stalls and SMS order alerts.
-- A market stall is run by someone who may only have a basic phone. A helper (family member, market
-- coordinator) manages the listing with their own account; the stall's phone (businesses.phone) gets
-- each order by SMS and can answer by SMS: 1 = accept, 2 = sold out, the customer's code = handed over.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS kind VARCHAR(12) NOT NULL DEFAULT 'shop';
ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_kind_check;
ALTER TABLE businesses ADD CONSTRAINT businesses_kind_check CHECK (kind IN ('shop', 'market_stall'));
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS stall_location VARCHAR(200);  -- e.g. "Main Street, by the taxi rank"
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS stall_days SMALLINT[];        -- ISO weekdays: 1 = Monday ... 7 = Sunday
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS stall_opens TIME;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS stall_closes TIME;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS sms_alerts BOOLEAN NOT NULL DEFAULT FALSE;

-- Order SMS sent to and received from businesses' phones (never sign-in codes). Kept 30 days.
CREATE TABLE IF NOT EXISTS sms_messages (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone      VARCHAR(15) NOT NULL,
  direction  VARCHAR(3)  NOT NULL CHECK (direction IN ('out', 'in')),
  body       TEXT        NOT NULL,
  order_id   BIGINT      REFERENCES orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sms_messages_phone ON sms_messages(phone, created_at);

-- 2026-10-26: AI screening (off-platform / scam detector). One row per version of a text that was
-- checked, so an edited description is checked again. Only flagged rows keep a copy of the text
-- (for support to read); flagged rows wait for a support decision. Nothing is hidden automatically.
CREATE TABLE IF NOT EXISTS screenings (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_type     VARCHAR(10) NOT NULL CHECK (item_type IN ('product', 'shop', 'review')),
  item_id       BIGINT      NOT NULL,
  text_hash     CHAR(64)    NOT NULL,
  flagged       BOOLEAN     NOT NULL,
  excerpt       TEXT,                          -- only when flagged
  score         REAL,
  reasons       TEXT[]      NOT NULL DEFAULT '{}',
  model_version VARCHAR(40) NOT NULL,
  status        VARCHAR(10) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'dismissed', 'actioned')),
  decided_by    BIGINT      REFERENCES users(id),
  decided_at    TIMESTAMPTZ,
  decision_note TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_type, item_id, text_hash)
);
CREATE INDEX IF NOT EXISTS idx_screenings_open ON screenings(flagged, status);

-- Typo-tolerant search ("spinich" finds spinach): letter-trigram similarity on product names.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (lower(name) gin_trgm_ops);

-- 2026-10-30: voice notes. A seller can record up to a minute about a product, in any language -
-- easier than typing for many sellers. One note per product; a new recording replaces the old one.
-- Kept in the database: a minute of compressed speech is only about 100-250 KB.
CREATE TABLE IF NOT EXISTS voice_notes (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id       BIGINT      NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  business_id      BIGINT      NOT NULL REFERENCES businesses(id),
  content_type     VARCHAR(20) NOT NULL CHECK (content_type IN ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg')),
  data             BYTEA       NOT NULL,
  bytes            INTEGER     NOT NULL CHECK (bytes > 0),
  duration_seconds SMALLINT    CHECK (duration_seconds BETWEEN 1 AND 60),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2026-10-30: Kuruman Business Directory - local SERVICES (plumbers, hairdressers, mechanics...) that people
-- phone directly. Free to list; the owner (or someone with the owner's permission) consents to the phone
-- number being public; support approves each listing before it appears.
CREATE TABLE IF NOT EXISTS directory_listings (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  category      VARCHAR(30)  NOT NULL,
  description   VARCHAR(400),
  area          VARCHAR(80)  NOT NULL,
  phone         VARCHAR(15)  NOT NULL,
  has_whatsapp  BOOLEAN      NOT NULL DEFAULT FALSE,
  hours         VARCHAR(80),
  submitted_by  BIGINT       NOT NULL REFERENCES users(id),
  consent_at    TIMESTAMPTZ  NOT NULL,           -- when the submitter confirmed the right to publish the number
  status        VARCHAR(10)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
  decided_by    BIGINT       REFERENCES users(id),
  decided_at    TIMESTAMPTZ,
  decision_note TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_directory_status ON directory_listings(status, category);

-- 2026-10-30: free calls over data (Twilio). The browser never learns anyone's number: the server picks
-- the number from the order or shop and Twilio dials it. Kept 30 days (who called whom is personal data).
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS calls_enabled BOOLEAN NOT NULL DEFAULT FALSE;  -- shop page "Call free"
CREATE TABLE IF NOT EXISTS calls (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  caller_id    BIGINT      NOT NULL REFERENCES users(id),
  callee_phone VARCHAR(15) NOT NULL,              -- only the server and Twilio ever see it
  order_id     BIGINT      REFERENCES orders(id) ON DELETE SET NULL,
  business_id  BIGINT      REFERENCES businesses(id),
  connected_at TIMESTAMPTZ,                       -- when Twilio asked us where to connect it (used once)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_id, created_at);

-- 2026-11-03: seller verification, like Payfast's. A seller applying uploads a copy of their ID document.
-- It is stored ENCRYPTED (lib/secretBox.ts, the key is not in the database), only support staff who
-- approve sellers can open it, every opening is in the audit log, and it is deleted 30 days after the
-- application is decided (lib/retention.ts). The email address and agreements are in the case details.
CREATE TABLE IF NOT EXISTS verification_documents (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id      BIGINT      NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,
  user_id      BIGINT      NOT NULL REFERENCES users(id),
  kind         VARCHAR(20) NOT NULL CHECK (kind IN ('id_document')),
  content_type VARCHAR(40) NOT NULL,
  data_enc     TEXT        NOT NULL,              -- the file, encrypted (AES-256-GCM)
  bytes        INTEGER     NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id, kind)
);

-- 2026-11-04: the trail of contact with someone who applied: every email the site sent them (received,
-- a question from support, the decision) and changes they made (a new ID document). Their replies go to
-- the admin's own inbox (Reply-To). Deleted 90 days after the application is closed, like case details.
CREATE TABLE IF NOT EXISTS case_messages (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id    BIGINT       NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,
  kind       VARCHAR(10)  NOT NULL CHECK (kind IN ('email', 'note')),
  sent_by    BIGINT       REFERENCES users(id),     -- NULL: sent by the site itself
  to_email   VARCHAR(120),
  subject    VARCHAR(200),
  body       TEXT         NOT NULL,
  status     VARCHAR(10)  CHECK (status IN ('sent', 'failed')),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_messages_case ON case_messages(case_id, id);

-- 2026-11-04: help tickets, like Twilio's support centre. Anyone signed in opens a ticket on the site and
-- follows it there (no email needed): its number, status and the conversation with support.
--   open     = waiting for support        answered = support replied, waiting for the person
--   closed   = done (either side closed it)
-- Deleted 12 months after closing (lib/retention.ts).
CREATE TABLE IF NOT EXISTS tickets (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT       NOT NULL REFERENCES users(id),
  topic      VARCHAR(20)  NOT NULL CHECK (topic IN ('order', 'selling', 'payment', 'account', 'other')),
  subject    VARCHAR(120) NOT NULL,
  status     VARCHAR(10)  NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  closed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, updated_at);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id    BIGINT      NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id    BIGINT      NOT NULL REFERENCES users(id),
  from_support BOOLEAN     NOT NULL,
  body         TEXT        NOT NULL CHECK (char_length(body) <= 2000),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_messages ON ticket_messages(ticket_id, id);

-- 2026-11-04: which version of the terms of use (and the privacy notice and returns policy that go with
-- them) each person accepted, and when - like Payfast's "Updates to our end-user agreement". When the
-- version changes, everyone is asked to accept again before they carry on.
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

-- 2026-11-04: couriers are verified too: their ID document, a police clearance certificate, and - if they
-- deliver with a motorbike, car or bakkie - their driver's licence. Same protection as sellers' IDs.
ALTER TABLE verification_documents DROP CONSTRAINT IF EXISTS verification_documents_kind_check;
ALTER TABLE verification_documents ADD CONSTRAINT verification_documents_kind_check
  CHECK (kind IN ('id_document', 'drivers_licence', 'police_clearance'));

-- 2026-11-04: couriers' documents after approval.
--   documents_outstanding: the documents a courier still has to give us ('{}' = all on file and checked);
--   documents_due:         after this date they can't take new jobs until those documents are checked.
-- A courier approved with only PROOF that they applied for police clearance gets 30 days to send the
-- certificate. Couriers approved before document checks started are asked for all their documents, with
-- 14 days (the UPDATE below touches only rows never assessed, so running this again changes nothing).
ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS documents_outstanding TEXT[];
ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS documents_due DATE;
ALTER TABLE support_cases DROP CONSTRAINT IF EXISTS support_cases_case_type_check;
ALTER TABLE support_cases ADD CONSTRAINT support_cases_case_type_check CHECK (case_type IN (
  'seller_application', 'courier_application', 'refund', 'cash_dispute', 'fulfilment', 'order_problem',
  'privacy_access', 'privacy_correction', 'privacy_deletion',
  'courier_documents'   -- documents a courier sends after approval, for support to check
));
CREATE UNIQUE INDEX IF NOT EXISTS one_open_documents_case_per_user ON support_cases(requester_id)
  WHERE status = 'open' AND case_type = 'courier_documents';
UPDATE courier_profiles
   SET documents_outstanding = CASE WHEN vehicle_type IN ('motorbike', 'car', 'bakkie')
                                    THEN '{id_document,drivers_licence,police_clearance}'::text[]
                                    ELSE '{id_document,police_clearance}'::text[] END,
       documents_due = current_date + 14
 WHERE documents_outstanding IS NULL;
