import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

async function backfillWallets() {
  const client = await pool.connect();
  console.log("✅ Connected to database");

  try {
    await client.query("BEGIN");

    // ── Step 1: Find all maids with completed bookings ────────────
    const { rows: earnRows } = await client.query(`
      SELECT
        b.maid_id,
        COALESCE(p.currency, mp.currency, 'NGN') AS currency,
        COALESCE(SUM(b.total_amount * 0.9), 0)   AS total_earned
      FROM bookings b
      LEFT JOIN payments p
        ON p.booking_id = b.id AND p.status = 'success'
      LEFT JOIN maid_profiles mp
        ON mp.user_id = b.maid_id
      WHERE b.status = 'completed'
        AND b.total_amount > 0
      GROUP BY b.maid_id, COALESCE(p.currency, mp.currency, 'NGN')
    `);

    console.log(
      `\n📊 Found ${earnRows.length} maid+currency combinations to backfill`,
    );

    // ── Step 2: Upsert wallet row for each maid+currency ──────────
    let inserted = 0;
    let updated = 0;

    for (const row of earnRows) {
      const currency = (row.currency || "NGN").toUpperCase();
      const earned = Number(row.total_earned);

      const { rows: existing } = await client.query(
        `SELECT id, total_earned FROM maid_wallets
         WHERE maid_id = $1 AND currency = $2`,
        [row.maid_id, currency],
      );

      if (existing.length === 0) {
        await client.query(
          `INSERT INTO maid_wallets
     (maid_id, currency, available_balance, pending_balance, total_earned, total_withdrawn)
   VALUES ($1, $2, $3, 0, $3, 0)
   ON CONFLICT (maid_id, currency)
   DO UPDATE SET
     total_earned = GREATEST(maid_wallets.total_earned, $3),
     available_balance = CASE
       WHEN (maid_wallets.available_balance + maid_wallets.pending_balance) < $3
       THEN GREATEST(maid_wallets.available_balance, $3 - maid_wallets.total_withdrawn - maid_wallets.pending_balance)
       ELSE maid_wallets.available_balance
     END,
     updated_at = now()`,
          [row.maid_id, currency, earned],
        );
        console.log(
          `  ➕ Created wallet: maid=${row.maid_id.slice(0, 8)} currency=${currency} earned=${earned}`,
        );
        inserted++;
      } else {
        const currentEarned = Number(existing[0].total_earned);
        if (earned > currentEarned) {
          await client.query(
            `UPDATE maid_wallets
     SET total_earned = GREATEST(total_earned, $1),
         available_balance = GREATEST(
           available_balance,
           GREATEST(0, $1 - total_withdrawn - pending_balance)
         ),
         updated_at = now()
     WHERE maid_id = $2 AND currency = $3`,
            [earned, row.maid_id, currency],
          );
          console.log(
            `  🔄 Fixed: maid=${row.maid_id.slice(0, 8)} currency=${currency} available set to ${earned}`,
          );
          updated++;
        } else {
          console.log(
            `  ✓ OK: maid=${row.maid_id.slice(0, 8)} currency=${currency} earned=${currentEarned}`,
          );
        }
      }
    }

    // ── Step 3: Ensure every maid has at least an NGN wallet ──────
    const { rows: allMaids } = await client.query(
      `SELECT user_id FROM maid_profiles`,
    );

    let ngnCreated = 0;
    for (const maid of allMaids) {
      await client.query(
        `INSERT INTO maid_wallets (maid_id, currency, available_balance, pending_balance, total_earned, total_withdrawn)
         VALUES ($1, 'NGN', 0, 0, 0, 0)
         ON CONFLICT (maid_id, currency) DO NOTHING`,
        [maid.user_id],
      );
      ngnCreated++;
    }

    await client.query("COMMIT");

    console.log(`\n✅ Backfill complete:`);
    console.log(`   Wallets created : ${inserted}`);
    console.log(`   Wallets updated : ${updated}`);
    console.log(`   NGN wallets ensured: ${ngnCreated}`);

    // ── Step 4: Print summary of all wallets ──────────────────────
    const { rows: summary } = await client.query(`
      SELECT
        mw.currency,
        COUNT(*)                          AS total_maids,
        SUM(mw.total_earned)              AS total_earned,
        SUM(mw.available_balance)         AS total_available
      FROM maid_wallets mw
      GROUP BY mw.currency
      ORDER BY total_earned DESC
    `);

    console.log(`\n📈 Wallet summary by currency:`);
    for (const row of summary) {
      console.log(
        `   ${row.currency}: ${row.total_maids} maids, ` +
          `earned=${Number(row.total_earned).toLocaleString()}, ` +
          `available=${Number(row.total_available).toLocaleString()}`,
      );
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Backfill failed — rolled back:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
    console.log("\n🔌 Database connection closed");
  }
}

backfillWallets();
