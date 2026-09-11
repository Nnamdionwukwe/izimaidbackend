-- db/seed/foundation.controller.sql
-- Matches: src/controllers/foundation.controller.js
--          src/models/FoundationDonation.js
-- Creates: foundation_donations
--
-- NOTE: verifyDonationPayment and webhook in the controller call
--       findByEmail("") which returns zero rows — a known bug. When fixed,
--       the correct lookup is: WHERE payment_reference = $1 (unique index
--       on that column is already in place).

-- ══════════════════════════════════════════════════════════════════════
--  foundation_donations — donations to the foundation
--  Public form, no user account required.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS foundation_donations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Donor info
  donor_name         TEXT NOT NULL,
  donor_email        TEXT NOT NULL,
  donor_message      TEXT,

  -- Donation details
  amount             NUMERIC(12,2) NOT NULL,
  donation_type      TEXT NOT NULL DEFAULT 'once'
                       CHECK (donation_type IN ('once','monthly')),

  -- Lifecycle
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','completed','failed','refunded')),

  -- Payment tracking
  payment_reference  TEXT UNIQUE,       -- 'FD-<digits>-<digits>'
  payment_method     TEXT,              -- 'flutterwave'
  transaction_id     TEXT,

  -- Admin
  admin_notes        TEXT,

  -- Completion
  completed_at       TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_foundation_donations_status       ON foundation_donations (status);
CREATE INDEX IF NOT EXISTS idx_foundation_donations_type         ON foundation_donations (donation_type);
CREATE INDEX IF NOT EXISTS idx_foundation_donations_email        ON foundation_donations (LOWER(donor_email));
CREATE INDEX IF NOT EXISTS idx_foundation_donations_reference    ON foundation_donations (payment_reference);
CREATE INDEX IF NOT EXISTS idx_foundation_donations_completed    ON foundation_donations (completed_at)
  WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS idx_foundation_donations_created      ON foundation_donations (created_at DESC);

DROP TRIGGER IF EXISTS trg_foundation_donations_updated_at ON foundation_donations;
CREATE TRIGGER trg_foundation_donations_updated_at
  BEFORE UPDATE ON foundation_donations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();