// scripts/backfill-wallet.js
// node --env-file=.env scripts/backfill-wallet.js

import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log("🔌 Connected\n");
    await client.query("BEGIN");

    const { rows: bookings } = await client.query(`
      SELECT
        b.id,
        b.maid_id,
        b.total_amount,
        b.created_at,
        COALESCE(p.currency, mp.currency, 'NGN') AS currency
      FROM bookings b
      LEFT JOIN payments p
        ON p.booking_id = b.id AND p.status = 'success'
      LEFT JOIN maid_profiles mp
        ON mp.user_id = b.maid_id
      WHERE b.status = 'completed'
        AND b.total_amount > 0
        AND NOT EXISTS (
          SELECT 1 FROM wallet_transactions wt
          WHERE wt.booking_id = b.id AND wt.type = 'credit'
        )
      ORDER BY b.maid_id, b.created_at ASC
    `);

    console.log(`Found ${bookings.length} completed bookings to backfill\n`);

    if (!bookings.length) {
      console.log("✅ Already up to date");
      await client.query("COMMIT");
      return;
    }

    // Group by maid+currency
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
      // Ensure wallet row exists for this currency
      await client.query(
        `
        INSERT INTO maid_wallets (maid_id, currency, available_balance, pending_balance, total_earned, total_withdrawn)
        VALUES ($1, $2, 0, 0, 0, 0)
        ON CONFLICT (maid_id, currency) DO NOTHING
      `,
        [maid_id, currency],
      );

      let runningBalance = 0;
      for (const b of bList) {
        const payout = Number(b.total_amount) * 0.9;
        runningBalance += payout;
        await client.query(
          `
          INSERT INTO wallet_transactions
            (maid_id, currency, type, amount, balance_after, description, booking_id, created_at)
          VALUES ($1, $2, 'credit', $3, $4, 'Booking payment (backfill)', $5, $6)
        `,
          [maid_id, currency, payout, runningBalance, b.id, b.created_at],
        );
        txCount++;
      }

      const totalPayout = bList.reduce(
        (s, b) => s + Number(b.total_amount) * 0.9,
        0,
      );
      await client.query(
        `
        UPDATE maid_wallets
        SET
          available_balance = available_balance + $1,
          total_earned      = total_earned      + $1,
          updated_at        = now()
        WHERE maid_id = $2 AND currency = $3
      `,
        [totalPayout, maid_id, currency],
      );

      console.log(
        `  ✅ ${maid_id.slice(0, 8)}… | ${currency} | ${bList.length} bookings | +${totalPayout.toFixed(2)}`,
      );
    }

    await client.query("COMMIT");
    console.log(`\n✅ Done — ${txCount} transactions created. Restart server.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Backfill failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
run();
