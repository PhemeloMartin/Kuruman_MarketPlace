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
