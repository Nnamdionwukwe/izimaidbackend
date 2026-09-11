-- db/seed/giftCertificate.controller.sql
-- Matches: src/controllers/giftCertificate.controller.js
--          src/models/GiftCertificate.js
-- Creates: gift_certificates

-- ══════════════════════════════════════════════════════════════════════
--  gift_certificates — pre-paid gift certificates
--  Flow: create (pending) → Flutterwave payment → verify/webhook (active)
--        → redeem (redeemed) | expire (expired) | cancel (cancelled)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS gift_certificates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Human-readable unique code, e.g. 'DSPK-A1B2-C3D4'
  certificate_code      TEXT NOT NULL UNIQUE,

  -- Sender / recipient
  from_name             TEXT NOT NULL,
  recipient_name        TEXT NOT NULL,
  recipient_email       TEXT NOT NULL,
  recipient_phone       TEXT,

  -- Gift details
  amount                NUMERIC(12,2) NOT NULL,
  message               TEXT,
  delivery_date         TIMESTAMPTZ,
  occasion              TEXT,

  -- Lifecycle
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','active','redeemed','expired','cancelled')),

  -- Payment tracking
  purchase_reference    TEXT UNIQUE,
  payment_method        TEXT,
  transaction_id        TEXT,

  -- Redemption
  redeemed_at           TIMESTAMPTZ,
  redeemed_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  booking_id            UUID REFERENCES bookings(id) ON DELETE SET NULL,

  -- Expiry (set at creation, +1 year)
  expires_at            TIMESTAMPTZ NOT NULL,

  -- Admin
  admin_notes           TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gift_certs_code          ON gift_certificates (certificate_code);
CREATE INDEX IF NOT EXISTS idx_gift_certs_status        ON gift_certificates (status);
CREATE INDEX IF NOT EXISTS idx_gift_certs_occasion      ON gift_certificates (occasion);
CREATE INDEX IF NOT EXISTS idx_gift_certs_recipient     ON gift_certificates (LOWER(recipient_email));
CREATE INDEX IF NOT EXISTS idx_gift_certs_purchase_ref  ON gift_certificates (purchase_reference);
CREATE INDEX IF NOT EXISTS idx_gift_certs_expires       ON gift_certificates (expires_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_gift_certs_created       ON gift_certificates (created_at DESC);

DROP TRIGGER IF EXISTS trg_gift_certs_updated_at ON gift_certificates;
CREATE TRIGGER trg_gift_certs_updated_at
  BEFORE UPDATE ON gift_certificates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();