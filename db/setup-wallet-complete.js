// db/setup-wallet-complete.js
import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    "postgresql://postgres:lFTWaNFqrAsULGNgOuwhZkrdjAIlHIMq@centerbeam.proxy.rlwy.net:46630/railway",
  ssl: false,
});

async function run() {
  const client = await pool.connect();
  try {
    const { rows: dbInfo } = await client.query(
      `SELECT current_database(), current_user`,
    );
    console.log(
      `🔌 Connected to: ${dbInfo[0].current_database} as ${dbInfo[0].current_user}\n`,
    );

    const { rows: tables } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    const tableNames = tables.map((t) => t.table_name);
    console.log("Tables:", tableNames.join(", "), "\n");

    if (!tableNames.includes("bookings"))
      throw new Error("bookings not found — wrong DB?");

    await client.query("BEGIN");

    // ── 1. maid_wallets ───────────────────────────────────────────
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
      console.log("ℹ️  maid_wallets exists — fixing schema...");

      // Drop wrong unique constraints (those only on maid_id alone)
      const { rows: badConstraints } = await client.query(`
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'maid_wallets'::regclass
          AND c.contype = 'u'
          AND c.conname != 'maid_wallets_maid_id_currency_key'
          AND array_length(c.conkey, 1) = 1
      `);
      for (const c of badConstraints) {
        await client.query(
          `ALTER TABLE maid_wallets DROP CONSTRAINT "${c.conname}"`,
        );
        console.log(`  Dropped: ${c.conname}`);
      }

      for (const [col, def] of [
        ["currency", "TEXT NOT NULL DEFAULT 'NGN'"],
        ["available_balance", "NUMERIC(14,2) NOT NULL DEFAULT 0"],
        ["pending_balance", "NUMERIC(14,2) NOT NULL DEFAULT 0"],
        ["total_earned", "NUMERIC(14,2) NOT NULL DEFAULT 0"],
        ["total_withdrawn", "NUMERIC(14,2) NOT NULL DEFAULT 0"],
        ["updated_at", "TIMESTAMPTZ DEFAULT now()"],
      ]) {
        await client.query(
          `ALTER TABLE maid_wallets ADD COLUMN IF NOT EXISTS ${col} ${def}`,
        );
      }

      await client.query(
        `UPDATE maid_wallets SET currency = 'NGN' WHERE currency IS NULL OR currency = ''`,
      );

      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'maid_wallets_maid_id_currency_key'
          ) THEN
            ALTER TABLE maid_wallets ADD CONSTRAINT maid_wallets_maid_id_currency_key UNIQUE (maid_id, currency);
          END IF;
        END $$
      `);
      console.log("✅ maid_wallets schema OK");
    }

    // ── 2. wallet_transactions ────────────────────────────────────
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
        CREATE INDEX IF NOT EXISTS idx_wallet_tx_maid
          ON wallet_transactions(maid_id, currency, created_at DESC)
      `);
      console.log("✅ Created wallet_transactions");
    } else {
      for (const [col, def] of [
        ["reference", "TEXT"],
        ["booking_id", "UUID"],
        ["withdrawal_id", "UUID"],
        ["balance_after", "NUMERIC(14,2)"],
        ["description", "TEXT"],
      ]) {
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

    // ── 4. Seed NGN wallet for all existing maids ─────────────────
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
    console.log("\n✅ Schema done\n");

    // ── 5. Backfill completed bookings ────────────────────────────
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

    console.log(`Found ${bookings.length} completed bookings to backfill`);

    if (bookings.length > 0) {
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
          `  ✅ ${maid_id.slice(0, 8)}… | ${currency} | ${bList.length} booking(s) | +${total.toFixed(2)}`,
        );
      }

      await client.query("COMMIT");
      console.log(`\n✅ Backfilled ${txCount} transactions`);
    } else {
      await client.query("COMMIT");
      console.log("✅ Nothing to backfill");
    }

    // ── 6. Summary ────────────────────────────────────────────────
    const { rows: summary } = await client.query(`
      SELECT currency,
             COUNT(*)                  AS maids,
             SUM(available_balance)    AS available,
             SUM(total_earned)         AS earned
      FROM maid_wallets
      GROUP BY currency ORDER BY earned DESC
    `);
    console.log("\n📊 Wallet summary:");
    for (const r of summary) {
      console.log(
        `  ${r.currency}: ${r.maids} maid(s) | Available: ${Number(r.available).toFixed(2)} | Earned: ${Number(r.earned).toFixed(2)}`,
      );
    }

    console.log(
      "\n━━━━━━━━━━━━━━━━━━━━━━━\n✅ ALL DONE — restart server\n━━━━━━━━━━━━━━━━━━━━━━━",
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("❌ Failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
