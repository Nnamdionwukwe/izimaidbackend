// scripts/setup-wallet-complete.js
// node --env-file=.env scripts/setup-wallet-complete.js

import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : { rejectUnauthorized: false }, // Railway needs SSL even in dev
  max: 5,
});

async function run() {
  const client = await pool.connect();
  try {
    // Verify we're on the right database
    const { rows: dbInfo } = await client.query(
      `SELECT current_database(), current_user`,
    );
    console.log(
      `🔌 Connected to: ${dbInfo[0].current_database} as ${dbInfo[0].current_user}\n`,
    );

    // Confirm bookings table exists (sanity check)
    const { rows: tables } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    const tableNames = tables.map((t) => t.table_name);
    console.log("Tables found:", tableNames.join(", "), "\n");

    if (!tableNames.includes("bookings")) {
      throw new Error("bookings table not found — wrong database?");
    }

    await client.query("BEGIN");

    // ── 1. Create maid_wallets ────────────────────────────────────
    if (!tableNames.includes("maid_wallets")) {
      await client.query(`
        CREATE TABLE maid_wallets (
          id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          maid_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          currency          TEXT NOT NULL DEFAULT 'NGN',
          available_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
          pending_balance   NUMERIC(14,2) NOT NULL DEFAULT 0,
          total_earned      NUMERIC(14,2) NOT NULL DEFAULT 0,
          total_withdrawn   NUMERIC(14,2) NOT NULL DEFAULT 0,
          updated_at        TIMESTAMPTZ DEFAULT now(),
          UNIQUE(maid_id, currency)
        )
      `);
      console.log("✅ Created maid_wallets");
    } else {
      console.log("ℹ️  maid_wallets exists — adding missing columns...");

      // Drop wrong unique constraint if it only covers maid_id alone
      const { rows: wrongConstraints } = await client.query(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'maid_wallets'::regclass
          AND contype = 'u'
          AND conname != 'maid_wallets_maid_id_currency_key'
      `);
      for (const c of wrongConstraints) {
        await client.query(
          `ALTER TABLE maid_wallets DROP CONSTRAINT IF EXISTS "${c.conname}"`,
        );
        console.log(`  Dropped wrong constraint: ${c.conname}`);
      }

      // Add all columns safely
      const cols = [
        [`currency`, `TEXT NOT NULL DEFAULT 'NGN'`],
        [`available_balance`, `NUMERIC(14,2) NOT NULL DEFAULT 0`],
        [`pending_balance`, `NUMERIC(14,2) NOT NULL DEFAULT 0`],
        [`total_earned`, `NUMERIC(14,2) NOT NULL DEFAULT 0`],
        [`total_withdrawn`, `NUMERIC(14,2) NOT NULL DEFAULT 0`],
        [`updated_at`, `TIMESTAMPTZ DEFAULT now()`],
      ];
      for (const [col, def] of cols) {
        await client.query(
          `ALTER TABLE maid_wallets ADD COLUMN IF NOT EXISTS ${col} ${def}`,
        );
      }

      // Fix null currencies
      await client.query(
        `UPDATE maid_wallets SET currency = 'NGN' WHERE currency IS NULL OR currency = ''`,
      );

      // Add correct unique constraint
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'maid_wallets_maid_id_currency_key'
          ) THEN
            ALTER TABLE maid_wallets ADD CONSTRAINT maid_wallets_maid_id_currency_key UNIQUE (maid_id, currency);
          END IF;
        END $$
      `);
      console.log("✅ maid_wallets schema fixed");
    }

    // ── 2. Create wallet_transactions ─────────────────────────────
    if (!tableNames.includes("wallet_transactions")) {
      await client.query(`
        CREATE TABLE wallet_transactions (
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
        CREATE INDEX idx_wallet_tx_maid
          ON wallet_transactions(maid_id, currency, created_at DESC)
      `);
      console.log("✅ Created wallet_transactions");
    } else {
      // Add missing columns to existing table
      const txCols = [
        [`reference`, `TEXT`],
        [`booking_id`, `UUID`],
        [`withdrawal_id`, `UUID`],
        [`balance_after`, `NUMERIC(14,2)`],
        [`description`, `TEXT`],
      ];
      for (const [col, def] of txCols) {
        await client.query(
          `ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS ${col} ${def}`,
        );
      }
      console.log("✅ wallet_transactions columns OK");
    }

    // ── 3. withdrawals.currency ───────────────────────────────────
    await client.query(
      `ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'NGN'`,
    );
    console.log("✅ withdrawals.currency OK");

    // ── 4. Seed NGN wallet for all maids ─────────────────────────
    const { rowCount: seeded } = await client.query(`
      INSERT INTO maid_wallets (maid_id, currency, available_balance, pending_balance, total_earned, total_withdrawn)
      SELECT u.id, 'NGN', 0, 0, 0, 0
      FROM users u
      WHERE u.role = 'maid'
        AND NOT EXISTS (
          SELECT 1 FROM maid_wallets w WHERE w.maid_id = u.id AND w.currency = 'NGN'
        )
    `);
    console.log(`✅ Seeded NGN wallet for ${seeded} maid(s)`);

    await client.query("COMMIT");
    console.log("\n✅ Schema setup complete\n");

    // ── 5. Backfill from completed bookings ───────────────────────
    console.log("Starting backfill from completed bookings...\n");
    await client.query("BEGIN");

    const { rows: bookings } = await client.query(`
      SELECT
        b.id,
        b.maid_id,
        b.total_amount,
        b.created_at,
        COALESCE(p.currency, mp.currency, 'NGN') AS currency
      FROM bookings b
      LEFT JOIN payments p ON p.booking_id = b.id AND p.status = 'success'
      LEFT JOIN maid_profiles mp ON mp.user_id = b.maid_id
      WHERE b.status = 'completed'
        AND b.total_amount > 0
        AND NOT EXISTS (
          SELECT 1 FROM wallet_transactions wt
          WHERE wt.booking_id = b.id AND wt.type = 'credit'
        )
      ORDER BY b.maid_id, b.created_at ASC
    `);

    console.log(`Found ${bookings.length} bookings to backfill`);

    if (bookings.length > 0) {
      // Group by maid + currency
      const grouped = {};
      for (const b of bookings) {
        const key = `${b.maid_id}::${b.currency}`;
        if (!grouped[key])
          grouped[key] = {
            maid_id: b.maid_id,
            currency: b.currency,
            bookings: [],
          };
        grouped[key].bookings.push(b);
      }

      let txCount = 0;
      for (const { maid_id, currency, bookings: bList } of Object.values(
        grouped,
      )) {
        // Ensure wallet row for this currency
        await client.query(
          `
          INSERT INTO maid_wallets (maid_id, currency, available_balance, pending_balance, total_earned, total_withdrawn)
          VALUES ($1, $2, 0, 0, 0, 0)
          ON CONFLICT (maid_id, currency) DO NOTHING
        `,
          [maid_id, currency],
        );

        let running = 0;
        for (const b of bList) {
          const payout = Number(b.total_amount) * 0.9;
          running += payout;
          await client.query(
            `
            INSERT INTO wallet_transactions
              (maid_id, currency, type, amount, balance_after, description, booking_id, created_at)
            VALUES ($1, $2, 'credit', $3, $4, 'Booking payment (backfill)', $5, $6)
          `,
            [maid_id, currency, payout, running, b.id, b.created_at],
          );
          txCount++;
        }

        const total = bList.reduce(
          (s, b) => s + Number(b.total_amount) * 0.9,
          0,
        );
        await client.query(
          `
          UPDATE maid_wallets
          SET available_balance = available_balance + $1,
              total_earned      = total_earned      + $1,
              updated_at        = now()
          WHERE maid_id = $2 AND currency = $3
        `,
          [total, maid_id, currency],
        );

        console.log(
          `  ✅ ${maid_id.slice(0, 8)}… | ${currency} | ${bList.length} bookings | +${total.toFixed(2)}`,
        );
      }

      await client.query("COMMIT");
      console.log(`\n✅ Backfilled ${txCount} transactions`);
    } else {
      await client.query("COMMIT");
    }

    // ── 6. Final summary ──────────────────────────────────────────
    const { rows: walletSummary } = await client.query(`
      SELECT mw.currency, COUNT(*) as maids,
             SUM(mw.available_balance) as total_available,
             SUM(mw.total_earned) as total_earned
      FROM maid_wallets mw
      GROUP BY mw.currency
      ORDER BY total_earned DESC
    `);

    console.log("\n📊 Wallet summary:");
    for (const row of walletSummary) {
      console.log(
        `  ${row.currency}: ${row.maids} maid(s) | Available: ${Number(row.total_available).toFixed(2)} | Earned: ${Number(row.total_earned).toFixed(2)}`,
      );
    }

    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ ALL DONE — restart your server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("❌ Failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
