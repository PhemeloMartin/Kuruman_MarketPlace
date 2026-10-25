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
