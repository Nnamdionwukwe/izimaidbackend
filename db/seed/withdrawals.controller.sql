-- db/seed/withdrawals.controller.sql
-- Matches: src/controllers/withdrawals.controller.js
-- Creates: withdrawals, pin_attempts (defensive), ng_banks (defensive)
-- Extends: users (adds transaction PIN columns)

-- ══════════════════════════════════════════════════════════════════════
--  users — extend with transaction PIN columns
--  Used by checkTransactionPin() in withdrawals.controller.js
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE users ADD COLUMN IF NOT EXISTS transaction_pin_hash  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_failed_attempts   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_locked_until      TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_pin_locked
  ON users (pin_locked_until)
  WHERE pin_locked_until IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════
--  pin_attempts — audit log of PIN entries (success + failure)
--  Also owned by auth.js — created here defensively
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pin_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  success      BOOLEAN NOT NULL,
  ip_address   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pin_attempts_user    ON pin_attempts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pin_attempts_success ON pin_attempts (user_id, success);

-- ══════════════════════════════════════════════════════════════════════
--  withdrawals — one row per withdrawal request
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS withdrawals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maid_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Amount + currency
  amount            NUMERIC(14,2) NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'NGN',
  fee               NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Method: how the maid wants to receive funds
  method            TEXT NOT NULL
                      CHECK (method IN (
                        'bank_transfer','wire_transfer','mobile_money',
                        'crypto','paypal','wise','flutterwave'
                      )),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN (
                        'pending','processing','paid','rejected','failed','cancelled'
                      )),

  -- Bank transfer (local NGN / other)
  bank_name         TEXT,
  account_number    TEXT,
  account_name      TEXT,
  bank_code         TEXT,
  bank_country      TEXT,

  -- Wire / SWIFT
  swift_code        TEXT,
  iban              TEXT,
  bank_address      TEXT,

  -- Mobile money
  mobile_provider   TEXT,
  mobile_number     TEXT,
  mobile_country    TEXT,

  -- Crypto
  crypto_currency   TEXT,
  crypto_address    TEXT,
  crypto_network    TEXT,

  -- PayPal / Wise
  paypal_email      TEXT,
  wise_email        TEXT,

  -- Gateway result
  gateway_ref       TEXT,
  gateway_response  JSONB,
  failure_reason    TEXT,

  -- Admin review
  reviewed_by       UUID REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,

  notes             TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_maid         ON withdrawals (maid_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status       ON withdrawals (status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_method       ON withdrawals (method);
CREATE INDEX IF NOT EXISTS idx_withdrawals_created      ON withdrawals (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_pending      ON withdrawals (maid_id, status)
  WHERE status IN ('pending','processing');

DROP TRIGGER IF EXISTS trg_withdrawals_updated_at ON withdrawals;
CREATE TRIGGER trg_withdrawals_updated_at
  BEFORE UPDATE ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  ng_banks — Nigerian bank reference data (defensive stub)
--  Full reference seed will populate rows later.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ng_banks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL DEFAULT 'bank'
                CHECK (type IN ('bank','microfinance','fintech','mobile_money')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ng_banks_active ON ng_banks (is_active, type, name);
CREATE INDEX IF NOT EXISTS idx_ng_banks_code   ON ng_banks (code);

DROP TRIGGER IF EXISTS trg_ng_banks_updated_at ON ng_banks;
CREATE TRIGGER trg_ng_banks_updated_at
  BEFORE UPDATE ON ng_banks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  maid_bank_details — defensive ensure it has ON CONFLICT (maid_id) target
--  (already created in payments.sql with UNIQUE (maid_id))
-- ══════════════════════════════════════════════════════════════════════
-- Nothing to add — UNIQUE constraint on maid_id already exists.

-- ══════════════════════════════════════════════════════════════════════
--  wallet_transactions — defensive ensure withdrawal_id column exists
--  (already created in wallet.controller.sql; guard against older schemas)
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS withdrawal_id UUID;
CREATE INDEX IF NOT EXISTS idx_wallet_tx_withdrawal
  ON wallet_transactions (withdrawal_id)
  WHERE withdrawal_id IS NOT NULL;