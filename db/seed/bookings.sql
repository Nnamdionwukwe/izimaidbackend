-- db/seed/bookings.sql
-- Matches: src/controllers/bookings.js
-- Creates: bookings, booking_locations, emergency_contacts, sos_alerts
-- Extends: reviews (adds reviewer_id)
-- Stubs: payments (minimal — full schema comes from payments.js)

-- ══════════════════════════════════════════════════════════════════════
--  bookings — the central table
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bookings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Participants
  customer_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  maid_id               UUID NOT NULL REFERENCES maid_profiles(id) ON DELETE SET NULL,

  -- Service details
  service_date          TIMESTAMPTZ,
  duration_hours        NUMERIC(6,2),
  duration_qty          NUMERIC(6,2) DEFAULT 1,
  address               TEXT,
  notes                 TEXT,

  -- Pricing
  total_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  rate_type             TEXT NOT NULL DEFAULT 'hourly'
                          CHECK (rate_type IN ('hourly','daily','weekly','monthly','custom')),
  currency              TEXT NOT NULL DEFAULT 'NGN',   -- ← frozen at booking time

  -- Status
  status                TEXT NOT NULL DEFAULT 'awaiting_payment'
                          CHECK (status IN (
                            'awaiting_payment','pending','confirmed',
                            'in_progress','completed','cancelled','declined'
                          )),

  -- Escrow (only set when completed)
  escrow_status         TEXT
                          CHECK (escrow_status IS NULL OR escrow_status IN (
                            'pending_release','released'
                          )),
  escrow_released_at    TIMESTAMPTZ,
  escrow_released_by    UUID REFERENCES users(id),

  -- GPS check-in / check-out
  checkin_at            TIMESTAMPTZ,
  checkin_lat           NUMERIC(10,7),
  checkin_lng           NUMERIC(10,7),
  checkout_at           TIMESTAMPTZ,
  checkout_lat          NUMERIC(10,7),
  checkout_lng          NUMERIC(10,7),
  live_tracking_on      BOOLEAN NOT NULL DEFAULT false,

  -- Maid acceptance
  maid_accepted_at      TIMESTAMPTZ,

  -- Cancellation
  cancelled_by          TEXT,
  cancelled_by_user_id  UUID REFERENCES users(id),
  cancelled_reason      TEXT,
  cancelled_at          TIMESTAMPTZ,

  -- Recurring (referenced in select b.*)
  is_recurring          BOOLEAN NOT NULL DEFAULT false,
  recurrence_rule       TEXT,
  rescheduled_at        TIMESTAMPTZ,

  -- Video call (Agora)
  video_call_channel    TEXT,
  video_call_token      TEXT,
  video_call_status     TEXT DEFAULT 'none',
  video_call_started_at TIMESTAMPTZ,

  -- Legacy fields present in current DB
  service_type          TEXT,
  booking_date          TIMESTAMPTZ,
  video_call_room       TEXT,

  -- Timestamps
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bookings_customer         ON bookings (customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_maid             ON bookings (maid_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status           ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_bookings_escrow           ON bookings (escrow_status) WHERE escrow_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_service_date     ON bookings (service_date DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_created          ON bookings (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_currency         ON bookings (currency);
CREATE INDEX IF NOT EXISTS idx_bookings_video_call       ON bookings (video_call_status) WHERE video_call_status = 'ringing';

-- Auto-update trigger
DROP TRIGGER IF EXISTS trg_bookings_updated_at ON bookings;
CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  booking_locations — GPS pings during in_progress jobs
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS booking_locations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  maid_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat           NUMERIC(10,7),
  lng           NUMERIC(10,7),
  accuracy      NUMERIC(8,2),
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_locations_booking ON booking_locations (booking_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_locations_maid    ON booking_locations (maid_id);

-- ══════════════════════════════════════════════════════════════════════
--  emergency_contacts — per user, shown during active jobs
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,
  relationship  TEXT NOT NULL DEFAULT 'other',
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user ON emergency_contacts (user_id);

DROP TRIGGER IF EXISTS trg_emergency_contacts_updated_at ON emergency_contacts;
CREATE TRIGGER trg_emergency_contacts_updated_at
  BEFORE UPDATE ON emergency_contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  sos_alerts — triggered during active jobs
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sos_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  triggered_by  UUID NOT NULL REFERENCES users(id),
  lat           NUMERIC(10,7),
  lng           NUMERIC(10,7),
  address       TEXT,
  message       TEXT DEFAULT 'SOS triggered',
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','resolved')),
  resolved_by   UUID REFERENCES users(id),
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sos_alerts_booking ON sos_alerts (booking_id);
CREATE INDEX IF NOT EXISTS idx_sos_alerts_status  ON sos_alerts (status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sos_alerts_user    ON sos_alerts (triggered_by);

-- ══════════════════════════════════════════════════════════════════════
--  reviews — extend the minimal version from maids.sql
--  Adds: reviewer_id (used by some analytics), constraints cleaned up
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewer_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Ensure the unique constraint on booking_id exists (submitReview uses ON CONFLICT)
DO $$ BEGIN
  ALTER TABLE reviews ADD CONSTRAINT reviews_booking_id_unique UNIQUE (booking_id);
EXCEPTION WHEN duplicate_table THEN NULL;
         WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════════════
--  payments — MINIMAL stub for bookings.js joins
--  Full schema comes from payments.js. We only create it if missing.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            UUID REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  amount                NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency              TEXT NOT NULL DEFAULT 'NGN',
  gateway               TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',
  paystack_reference    TEXT,
  stripe_payment_id     TEXT,
  platform_fee          NUMERIC(12,2),
  maid_payout           NUMERIC(12,2),
  paid_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_booking  ON payments (booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_status   ON payments (status);
CREATE INDEX IF NOT EXISTS idx_payments_ref      ON payments (paystack_reference) WHERE paystack_reference IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════
--  push_tokens — used by savePushToken in bookings.js
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS push_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  platform     TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens (user_id) WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_push_tokens_updated_at ON push_tokens;
CREATE TRIGGER trg_push_tokens_updated_at
  BEFORE UPDATE ON push_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();