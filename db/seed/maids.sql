-- db/seed/maids.sql
-- Matches: src/controllers/maids.js
-- Extends maid_profiles (created minimally in auth.sql)
-- Adds: maid_availability, maid_documents
-- Also ensures reviews table exists (used by getMaidReviews)

-- ══════════════════════════════════════════════════════════════════════
--  maid_profiles — extend the minimal version from auth.sql
--  Every ALTER uses ADD COLUMN IF NOT EXISTS so it's idempotent.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS bio                    TEXT;
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS years_exp              INTEGER;
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS services               TEXT[];
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS location               TEXT;
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS rating                 NUMERIC(3,2) NOT NULL DEFAULT 0;
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS total_reviews          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS currency               TEXT NOT NULL DEFAULT 'NGN';
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS rate_hourly            NUMERIC(12,2);
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS rate_daily             NUMERIC(12,2);
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS rate_weekly            NUMERIC(12,2);
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS rate_monthly           NUMERIC(12,2);
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS rate_custom            JSONB;
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS pricing_note           TEXT;
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS latitude               NUMERIC(10,7);
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS longitude              NUMERIC(10,7);
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS languages              TEXT[];
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS max_distance_km        INTEGER NOT NULL DEFAULT 50;
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS completed_bookings     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS avatar_url             TEXT;
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS phone                  TEXT;
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS email                  TEXT;
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS full_name              TEXT;
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS pricing_note           TEXT;
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS verification_status    TEXT DEFAULT 'pending';
ALTER TABLE maid_profiles ADD COLUMN IF NOT EXISTS rejection_reason       TEXT;

-- Indexes for search performance
CREATE INDEX IF NOT EXISTS idx_maid_profiles_available    ON maid_profiles (is_available) WHERE is_available = true;
CREATE INDEX IF NOT EXISTS idx_maid_profiles_location     ON maid_profiles (LOWER(location));
CREATE INDEX IF NOT EXISTS idx_maid_profiles_rating       ON maid_profiles (rating DESC);
CREATE INDEX IF NOT EXISTS idx_maid_profiles_services     ON maid_profiles USING GIN (services);
CREATE INDEX IF NOT EXISTS idx_maid_profiles_languages    ON maid_profiles USING GIN (languages);
CREATE INDEX IF NOT EXISTS idx_maid_profiles_geo          ON maid_profiles (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_maid_profiles_currency     ON maid_profiles (currency);

-- ══════════════════════════════════════════════════════════════════════
--  maid_availability — weekly recurring slots
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS maid_availability (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maid_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week    INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time     TIME NOT NULL,
  end_time       TIME NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maid_availability_maid ON maid_availability (maid_id);
CREATE INDEX IF NOT EXISTS idx_maid_availability_dow  ON maid_availability (maid_id, day_of_week);

-- Auto-update trigger
DROP TRIGGER IF EXISTS trg_maid_availability_updated_at ON maid_availability;
CREATE TRIGGER trg_maid_availability_updated_at
  BEFORE UPDATE ON maid_availability
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  maid_documents — identity documents for verification
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS maid_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maid_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type        TEXT NOT NULL
                    CHECK (doc_type IN ('national_id','passport','utility_bill','drivers_license')),
  doc_url         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
  admin_notes     TEXT,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One document per type per maid
  UNIQUE (maid_id, doc_type)
);

CREATE INDEX IF NOT EXISTS idx_maid_documents_maid   ON maid_documents (maid_id);
CREATE INDEX IF NOT EXISTS idx_maid_documents_status ON maid_documents (status);

DROP TRIGGER IF EXISTS trg_maid_documents_updated_at ON maid_documents;
CREATE TRIGGER trg_maid_documents_updated_at
  BEFORE UPDATE ON maid_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  reviews — needed by getMaidReviews
--  Full schema will come from reviews.sql / bookings.sql
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    UUID,
  customer_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  maid_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The ON CONFLICT used in submitReview needs a unique key on booking_id
DO $$ BEGIN
  ALTER TABLE reviews ADD CONSTRAINT reviews_booking_id_unique UNIQUE (booking_id);
EXCEPTION WHEN duplicate_table THEN NULL;
         WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_reviews_maid       ON reviews (maid_id);
CREATE INDEX IF NOT EXISTS idx_reviews_customer   ON reviews (customer_id);
CREATE INDEX IF NOT EXISTS idx_reviews_booking    ON reviews (booking_id);