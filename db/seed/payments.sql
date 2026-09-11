-- db/seed/payments.sql
-- Matches: src/controllers/payments.js
-- Extends: payments (adds crypto, bank_transfer, payout columns)
-- Creates: maid_payouts, maid_bank_details

-- ══════════════════════════════════════════════════════════════════════
--  payments — extend the minimal version from bookings.sql
--  Uses ADD COLUMN IF NOT EXISTS so it's idempotent.
-- ══════════════════════════════════════════════════════════════════════

-- Flutterwave
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paystack_reference        TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paystack_access_code      TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_payment_id         TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_session_id         TEXT;

-- Bank transfer
ALTER TABLE payments ADD COLUMN IF NOT EXISTS bank_transfer_ref         TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS bank_transfer_proof       TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS bank_transfer_status      TEXT
  DEFAULT 'pending'
  CHECK (bank_transfer_status IN ('pending','awaiting_proof','proof_submitted','verified','rejected'));

-- Crypto (static Trust Wallet addresses)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS crypto_charge_id          TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS crypto_charge_code        TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS crypto_currency           TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS crypto_amount             NUMERIC(20,8);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS crypto_amount_sent        NUMERIC(20,8);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS crypto_address            TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS crypto_tx_hash            TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS crypto_proof_url          TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS crypto_expires_at         TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS crypto_status             TEXT
  DEFAULT 'pending'
  CHECK (crypto_status IN ('pending','proof_submitted','confirmed','failed'));

-- Payout tracking
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payout_status             TEXT
  DEFAULT 'pending'
  CHECK (payout_status IN ('pending','escrow','paid','refunded'));
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payout_at                 TIMESTAMPTZ;

-- Notes
ALTER TABLE payments ADD COLUMN IF NOT EXISTS notes                     TEXT;

-- "amount" is stored as NUMERIC — make sure it exists (already added in bookings.sql)

-- Additional indexes for payments queries
CREATE INDEX IF NOT EXISTS idx_payments_customer        ON payments (customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_gateway         ON payments (gateway);
CREATE INDEX IF NOT EXISTS idx_payments_gateway_status  ON payments (gateway, status);
CREATE INDEX IF NOT EXISTS idx_payments_crypto_status   ON payments (crypto_status) WHERE crypto_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_bank_status     ON payments (bank_transfer_status) WHERE bank_transfer_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_payout_status   ON payments (payout_status) WHERE payout_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_created         ON payments (created_at DESC);

-- Auto-update trigger
DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;
CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  maid_payouts — escrow → paid tracking per booking
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS maid_payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maid_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id      UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  payment_id      UUID REFERENCES payments(id),
  amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'NGN',
  status          TEXT NOT NULL DEFAULT 'escrow'
                    CHECK (status IN ('escrow','paid','cancelled','failed')),
  payout_ref      TEXT,
  notes           TEXT,
  processed_by    UUID REFERENCES users(id),
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maid_payouts_maid       ON maid_payouts (maid_id);
CREATE INDEX IF NOT EXISTS idx_maid_payouts_booking    ON maid_payouts (booking_id);
CREATE INDEX IF NOT EXISTS idx_maid_payouts_status     ON maid_payouts (status);
CREATE INDEX IF NOT EXISTS idx_maid_payouts_created    ON maid_payouts (created_at DESC);

DROP TRIGGER IF EXISTS trg_maid_payouts_updated_at ON maid_payouts;
CREATE TRIGGER trg_maid_payouts_updated_at
  BEFORE UPDATE ON maid_payouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  maid_bank_details — one per maid (upsert via ON CONFLICT)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS maid_bank_details (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maid_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  bank_name       TEXT NOT NULL,
  account_number  TEXT NOT NULL,
  account_name    TEXT NOT NULL,
  bank_code       TEXT,
  country         TEXT NOT NULL DEFAULT 'NG',
  currency        TEXT NOT NULL DEFAULT 'NGN',
  verified        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maid_bank_details_maid ON maid_bank_details (maid_id);

DROP TRIGGER IF EXISTS trg_maid_bank_details_updated_at ON maid_bank_details;
CREATE TRIGGER trg_maid_bank_details_updated_at
  BEFORE UPDATE ON maid_bank_details
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();