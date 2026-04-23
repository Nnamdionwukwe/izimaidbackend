// scripts/migrate-wallet.js
// node --env-file=.env scripts/migrate-wallet.js

import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("🔌 Connected\n");

    // ── maid_wallets ──────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS maid_wallets (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        maid_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        currency          TEXT NOT NULL DEFAULT 'NGN',
        available_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
        pending_balance   NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_earned      NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_withdrawn   NUMERIC(14,2) NOT NULL DEFAULT 0,
        updated_at        TIMESTAMPTZ DEFAULT now()
      )
    `);
    console.log("✅ maid_wallets table");

    // ── Add UNIQUE constraint if it doesn't exist yet ─────────────
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'maid_wallets_maid_id_currency_key'
        ) THEN
          ALTER TABLE maid_wallets
            ADD CONSTRAINT maid_wallets_maid_id_currency_key
            UNIQUE (maid_id, currency);
        END IF;
      END $$
    `);
    console.log("✅ UNIQUE(maid_id, currency) constraint");

    // ── wallet_transactions ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        maid_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        currency      TEXT NOT NULL DEFAULT 'NGN',
        type          TEXT NOT NULL CHECK (type IN ('credit','debit','escrow','release','refund','fee')),
        amount        NUMERIC(14,2) NOT NULL,
        balance_after NUMERIC(14,2),
        description   TEXT,
        reference     TEXT,
        booking_id    UUID,
        withdrawal_id UUID,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wallet_tx_maid
        ON wallet_transactions(maid_id, currency, created_at DESC)
    `);
    console.log("✅ wallet_transactions table");

    // ── withdrawals — add currency column if missing ──────────────
    await client.query(`
      ALTER TABLE withdrawals
        ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'NGN'
    `);
    console.log("✅ withdrawals.currency column");

    // ── Seed NGN wallet for every existing maid ───────────────────
    // Use INSERT ... WHERE NOT EXISTS to avoid ON CONFLICT dependency
    const { rowCount } = await client.query(`
      INSERT INTO maid_wallets (maid_id, currency)
      SELECT u.id, 'NGN'
      FROM users u
      WHERE u.role = 'maid'
        AND NOT EXISTS (
          SELECT 1 FROM maid_wallets w
          WHERE w.maid_id = u.id AND w.currency = 'NGN'
        )
    `);
    console.log(`✅ Seeded NGN wallet for ${rowCount} maid(s)`);

    await client.query("COMMIT");
    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Wallet migration complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
