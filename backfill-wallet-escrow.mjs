/**
 * backfill-wallet-escrow.mjs
 *
 * Finds all maid wallets that were credited for completed bookings
 * where the customer has NOT yet released the escrow, then reverses
 * those credits so balances reflect reality.
 *
 * Usage:
 *   node backfill-wallet-escrow.mjs            # dry run (no changes)
 *   node backfill-wallet-escrow.mjs --commit   # apply changes
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
  log(
    DRY_RUN
      ? "=== DRY RUN (no changes will be made) ==="
      : "=== COMMIT MODE ===",
  );

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const { rows: unreleased } = await client.query(`
      SELECT
        b.id          AS booking_id,
        b.maid_id,
        b.total_amount,
        b.escrow_status,
        COALESCE(p.currency, mp.currency, 'NGN') AS currency
      FROM bookings b
      LEFT JOIN payments      p  ON p.booking_id = b.id AND p.status = 'success'
      LEFT JOIN maid_profiles mp ON mp.user_id   = b.maid_id
      WHERE b.status        = 'completed'
        AND b.escrow_status != 'released'
        AND b.total_amount  > 0
      ORDER BY b.maid_id, b.updated_at
    `);

    log(
      `Found ${unreleased.length} completed booking(s) with escrow not yet released.`,
    );

    if (unreleased.length === 0) {
      log("Nothing to backfill. Exiting.");
      await client.query("ROLLBACK");
      return;
    }

    let creditsFound = 0;
    let creditsReversed = 0;
    let walletsAdjusted = new Set();

    for (const row of unreleased) {
      const { booking_id, maid_id, total_amount, currency, escrow_status } =
        row;
      const cur = (currency || "NGN").toUpperCase();
      const amount = Number(total_amount);

      const { rows: txRows } = await client.query(
        `
        SELECT id, amount, type, created_at
        FROM wallet_transactions
        WHERE maid_id    = $1
          AND booking_id = $2
          AND type       = 'credit'
        ORDER BY created_at ASC
      `,
        [maid_id, booking_id],
      );

      if (txRows.length === 0) {
        log(
          `  booking ${booking_id.slice(0, 8)} | maid ${maid_id.slice(0, 8)} | escrow=${escrow_status} → no wallet credit found, skipping`,
        );
        continue;
      }

      creditsFound += txRows.length;

      for (const tx of txRows) {
        const txAmt = Number(tx.amount);
        log(
          `  booking ${booking_id.slice(0, 8)} | maid ${maid_id.slice(0, 8)} | currency=${cur} | reversing credit of ${txAmt} (tx ${tx.id})`,
        );

        if (!DRY_RUN) {
          const { rows: walletRows } = await client.query(
            `
            SELECT available_balance, pending_balance
            FROM maid_wallets
            WHERE maid_id = $1 AND currency = $2
            FOR UPDATE
          `,
            [maid_id, cur],
          );

          if (!walletRows.length) {
            warn(
              `Wallet not found for maid ${maid_id} currency ${cur} — skipping`,
            );
            continue;
          }

          const available = Number(walletRows[0].available_balance);
          const pending = Number(walletRows[0].pending_balance);

          let deductPending = Math.min(pending, txAmt);
          let deductAvailable = Math.max(0, txAmt - deductPending);

          if (deductAvailable > available) {
            warn(
              `Available (${available}) less than deduction (${deductAvailable}) for maid ${maid_id} — clamping`,
            );
            deductAvailable = available;
          }

          const { rows: updated } = await client.query(
            `
            UPDATE maid_wallets
            SET
              pending_balance   = GREATEST(0, pending_balance   - $1),
              available_balance = GREATEST(0, available_balance - $2),
              total_earned      = GREATEST(0, total_earned      - $3),
              updated_at        = now()
            WHERE maid_id  = $4
              AND currency = $5
            RETURNING available_balance, pending_balance, total_earned
          `,
            [deductPending, deductAvailable, txAmt, maid_id, cur],
          );

          await client.query(
            `
            INSERT INTO wallet_transactions
              (maid_id, currency, type, amount, balance_after, description, booking_id)
            VALUES ($1, $2, 'debit', $3, $4, $5, $6)
          `,
            [
              maid_id,
              cur,
              txAmt,
              Number(updated[0]?.available_balance || 0),
              `[BACKFILL] Reversed premature credit — escrow not released (booking ${booking_id.slice(0, 8)})`,
              booking_id,
            ],
          );

          await client.query(
            `
            UPDATE wallet_transactions
            SET description = description || ' [REVERSED BY BACKFILL]'
            WHERE id = $1
          `,
            [tx.id],
          );

          walletsAdjusted.add(`${maid_id}:${cur}`);
          creditsReversed++;
        } else {
          creditsReversed++;
        }
      }
    }

    log("─────────────────────────────────────────");
    log(`Unreleased bookings found : ${unreleased.length}`);
    log(`Premature credits found   : ${creditsFound}`);
    log(`Credits to reverse        : ${creditsReversed}`);
    log(`Wallets affected          : ${walletsAdjusted.size}`);

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
