/**
 * fix-released-escrow-balances.mjs
 *
 * Moves funds from pending_balance → available_balance for all
 * bookings where escrow has already been released by the customer
 * but the money is still stuck in pending_balance.
 *
 * Usage:
 *   node fix-released-escrow-balances.mjs            # dry run
 *   node fix-released-escrow-balances.mjs --commit   # apply
 */

import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const DRY_RUN = !process.argv.includes("--commit");

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}
function warn(msg) {
  console.warn(`⚠️  ${msg}`);
}

async function main() {
  log(DRY_RUN ? "=== DRY RUN (no changes) ===" : "=== COMMIT MODE ===");

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // ── Find all released bookings and sum per maid+currency ──────
    const { rows: stuckFunds } = await client.query(`
      SELECT
        b.maid_id,
        COALESCE(p.currency, mp.currency, 'NGN') AS currency,
        SUM(b.total_amount)                        AS released_amount
      FROM bookings b
      LEFT JOIN payments      p  ON p.booking_id = b.id AND p.status = 'success'
      LEFT JOIN maid_profiles mp ON mp.user_id   = b.maid_id
      WHERE b.status        = 'completed'
        AND b.escrow_status = 'released'
        AND b.total_amount  > 0
      GROUP BY b.maid_id, COALESCE(p.currency, mp.currency, 'NGN')
    `);

    log(
      `Found ${stuckFunds.length} maid+currency combination(s) with released escrow.`,
    );

    if (stuckFunds.length === 0) {
      log("Nothing to fix. Exiting.");
      await client.query("ROLLBACK");
      return;
    }

    let fixed = 0;
    let skipped = 0;

    for (const row of stuckFunds) {
      const { maid_id, currency, released_amount } = row;
      const cur = (currency || "NGN").toUpperCase();
      const total = Number(released_amount);

      // ── Get current wallet state ─────────────────────────────────
      const { rows: walletRows } = await client.query(
        `
        SELECT available_balance, pending_balance, total_earned
        FROM maid_wallets
        WHERE maid_id = $1 AND currency = $2
      `,
        [maid_id, cur],
      );

      if (!walletRows.length) {
        warn(
          `No wallet found for maid ${maid_id.slice(0, 8)} currency ${cur} — skipping`,
        );
        skipped++;
        continue;
      }

      const available = Number(walletRows[0].available_balance);
      const pending = Number(walletRows[0].pending_balance);
      const earned = Number(walletRows[0].total_earned);

      // How much is stuck in pending that should be in available?
      // The released_amount is what SHOULD be available from released bookings.
      // We move whatever is sitting in pending up to that amount.
      const moveAmount = Math.min(pending, total);

      if (moveAmount <= 0) {
        log(
          `  maid ${maid_id.slice(0, 8)} | ${cur} | pending=${pending} — nothing stuck, skipping`,
        );
        skipped++;
        continue;
      }

      log(
        `  maid ${maid_id.slice(0, 8)} | ${cur} | moving ${moveAmount} from pending → available (pending=${pending}, available=${available})`,
      );

      if (!DRY_RUN) {
        // Move pending → available
        const { rows: updated } = await client.query(
          `
          UPDATE maid_wallets
          SET
            available_balance = available_balance + $1,
            pending_balance   = GREATEST(0, pending_balance - $1),
            updated_at        = now()
          WHERE maid_id  = $2
            AND currency = $3
          RETURNING available_balance, pending_balance
        `,
          [moveAmount, maid_id, cur],
        );

        // Log an audit transaction
        await client.query(
          `
          INSERT INTO wallet_transactions
            (maid_id, currency, type, amount, balance_after, description)
          VALUES ($1, $2, 'release', $3, $4, $5)
        `,
          [
            maid_id,
            cur,
            moveAmount,
            Number(updated[0].available_balance),
            `[FIX] Moved released escrow from pending to available balance`,
          ],
        );

        log(
          `    ✅ done — new available=${updated[0].available_balance}, pending=${updated[0].pending_balance}`,
        );
      }

      fixed++;
    }

    // ── Summary ───────────────────────────────────────────────────
    log("─────────────────────────────────────────");
    log(`Maid+currency combos found   : ${stuckFunds.length}`);
    log(`Fixed                        : ${fixed}`);
    log(`Skipped (nothing stuck)      : ${skipped}`);

    if (DRY_RUN) {
      log("DRY RUN — no changes committed. Re-run with --commit to apply.");
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
      log("✅ All changes committed successfully.");
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error — rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    await db.end();
  }
}

main();
