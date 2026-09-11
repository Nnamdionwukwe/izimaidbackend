-- db/seed/wallet.controller.sql
-- Matches: src/controllers/wallet.controller.js
-- Creates: maid_wallets, wallet_transactions

-- ══════════════════════════════════════════════════════════════════════
--  maid_wallets — one row per (maid, currency)
--  CRITICAL: only the UNIQUE (maid_id, currency) constraint is defined.
--  The old "UNIQUE (maid_id)" was removed — it blocked multi-currency.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS maid_wallets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maid_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency            TEXT NOT NULL DEFAULT 'NGN',

  -- Balances
  available_balance   NUMERIC(14,2) NOT NULL DEFAULT 0,
  pending_balance     NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_earned        NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_withdrawn     NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Legacy columns kept for compatibility (some old code may read "available"/"pending")
  available           NUMERIC(14,2) NOT NULL DEFAULT 0,
  pending             NUMERIC(14,2) NOT NULL DEFAULT 0,

  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ⚠️ ONLY this constraint — no UNIQUE (maid_id) alone
  UNIQUE (maid_id, currency)
);

CREATE INDEX IF NOT EXISTS idx_maid_wallets_maid      ON maid_wallets (maid_id);
CREATE INDEX IF NOT EXISTS idx_maid_wallets_currency  ON maid_wallets (currency);
CREATE INDEX IF NOT EXISTS idx_maid_wallets_maid_cur  ON maid_wallets (maid_id, currency);

DROP TRIGGER IF EXISTS trg_maid_wallets_updated_at ON maid_wallets;
CREATE TRIGGER trg_maid_wallets_updated_at
  BEFORE UPDATE ON maid_wallets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  wallet_transactions — immutable ledger
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maid_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency        TEXT NOT NULL DEFAULT 'NGN',

  -- 'credit' or 'debit'
  type            TEXT NOT NULL CHECK (type IN ('credit','debit')),

  amount          NUMERIC(14,2) NOT NULL,
  balance_after   NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Free-form description shown to the user
  description     TEXT,

  -- Source of the transaction: booking, escrow_release, withdrawal, admin_*, etc.
  source          TEXT NOT NULL DEFAULT 'system',
  source_id       UUID,

  -- Optional foreign references
  reference       TEXT,
  booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL,
  withdrawal_id   UUID,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_maid          ON wallet_transactions (maid_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_maid_currency ON wallet_transactions (maid_id, currency);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_created       ON wallet_transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_source        ON wallet_transactions (source);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_booking       ON wallet_transactions (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wallet_tx_withdrawal    ON wallet_transactions (withdrawal_id) WHERE withdrawal_id IS NOT NULL;