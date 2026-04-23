// scripts/fix-wallet-columns.js
// node --env-file=.env scripts/fix-wallet-columns.js

import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log("🔌 Connected\n");

    // Show current columns so we can see what exists
    const { rows: cols } = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'maid_wallets'
      ORDER BY ordinal_position
    `);
    console.log(
      "Current maid_wallets columns:",
      cols.map((c) => c.column_name),
    );

    await client.query("BEGIN");

    // Add every column — IF NOT EXISTS handles already-existing ones safely
    const alterations = [
      `ALTER TABLE maid_wallets ADD COLUMN IF NOT EXISTS available_balance NUMERIC(14,2) NOT NULL DEFAULT 0`,
      `ALTER TABLE maid_wallets ADD COLUMN IF NOT EXISTS pending_balance   NUMERIC(14,2) NOT NULL DEFAULT 0`,
      `ALTER TABLE maid_wallets ADD COLUMN IF NOT EXISTS total_earned      NUMERIC(14,2) NOT NULL DEFAULT 0`,
      `ALTER TABLE maid_wallets ADD COLUMN IF NOT EXISTS total_withdrawn   NUMERIC(14,2) NOT NULL DEFAULT 0`,
      `ALTER TABLE maid_wallets ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ   DEFAULT now()`,
      `ALTER TABLE maid_wallets ADD COLUMN IF NOT EXISTS currency          TEXT          NOT NULL DEFAULT 'NGN'`,
    ];

    for (const sql of alterations) {
      await client.query(sql);
      const col = sql.match(/ADD COLUMN IF NOT EXISTS (\w+)/)[1];
      console.log(`✅ ${col}`);
    }

    // Add UNIQUE constraint if missing
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
    console.log("✅ UNIQUE(maid_id, currency)");

    // Also create wallet_transactions if it got skipped
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
    console.log("✅ wallet_transactions");

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wallet_tx_maid
        ON wallet_transactions(maid_id, currency, created_at DESC)
    `);

    // Seed NGN wallet for all maids that don't have one
    const { rowCount } = await client.query(`
      INSERT INTO maid_wallets (maid_id, currency, available_balance, pending_balance, total_earned, total_withdrawn)
      SELECT u.id, 'NGN', 0, 0, 0, 0
      FROM users u
      WHERE u.role = 'maid'
        AND NOT EXISTS (
          SELECT 1 FROM maid_wallets w
          WHERE w.maid_id = u.id AND w.currency = 'NGN'
        )
    `);
    console.log(`✅ Seeded NGN wallet for ${rowCount} maid(s)`);

    await client.query("COMMIT");

    // Confirm final columns
    const { rows: finalCols } = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'maid_wallets'
      ORDER BY ordinal_position
    `);
    console.log("\nFinal maid_wallets columns:");
    finalCols.forEach((c) =>
      console.log(`  ${c.column_name} (${c.data_type})`),
    );
    console.log("\n✅ Fix complete — restart your server");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Fix failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
