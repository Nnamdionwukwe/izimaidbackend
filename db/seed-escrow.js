// db/seed-escrow.js
import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    "postgresql://postgres:lFTWaNFqrAsULGNgOuwhZkrdjAIlHIMq@centerbeam.proxy.rlwy.net:46630/railway",
  ssl: false,
});

async function run() {
  const client = await pool.connect();
  try {
    console.log("🔌 Connected\n");

    // Check maid_payouts table exists
    const { rows: tables } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'maid_payouts'
    `);

    if (!tables.length) {
      console.log("Creating maid_payouts table...");
      await client.query(`
        CREATE TABLE maid_payouts (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          maid_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          booking_id   UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
          payment_id   UUID REFERENCES payments(id),
          amount       NUMERIC(14,2) NOT NULL,
          currency     TEXT NOT NULL DEFAULT 'NGN',
          status       TEXT NOT NULL DEFAULT 'escrow'
                         CHECK (status IN ('escrow','paid','cancelled','refunded')),
          payout_ref   TEXT,
          notes        TEXT,
          processed_by UUID REFERENCES users(id),
          processed_at TIMESTAMPTZ,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_maid_payouts_booking
          ON maid_payouts(booking_id)
      `);
      console.log("✅ maid_payouts created");
    } else {
      // Add currency column if missing
      await client.query(`
        ALTER TABLE maid_payouts ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'NGN'
      `);
      console.log("✅ maid_payouts exists — currency column ensured");
    }

    // Also ensure payments has payout_status column
    await client.query(`
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS payout_status TEXT DEFAULT 'pending'
    `);
    await client.query(`
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS payout_at TIMESTAMPTZ
    `);
    console.log("✅ payments columns OK");

    // Seed escrow for all completed bookings that have a successful payment
    // but no payout record yet
    const { rows: bookings } = await client.query(`
      SELECT
        b.id          AS booking_id,
        b.maid_id,
        b.total_amount,
        p.id          AS payment_id,
        p.maid_payout,
        COALESCE(p.currency, mp.currency, 'NGN') AS currency
      FROM bookings b
      JOIN payments p ON p.booking_id = b.id AND p.status = 'success'
      LEFT JOIN maid_profiles mp ON mp.user_id = b.maid_id
      WHERE b.status IN ('completed', 'confirmed', 'in_progress')
        AND NOT EXISTS (
          SELECT 1 FROM maid_payouts mp2 WHERE mp2.booking_id = b.id
        )
      ORDER BY b.maid_id, b.created_at ASC
    `);

    console.log(`\nFound ${bookings.length} bookings to seed escrow for\n`);

    let seeded = 0;
    for (const b of bookings) {
      const payoutAmount = b.maid_payout
        ? Number(b.maid_payout)
        : Number(b.total_amount) * 0.9;

      const status = "escrow"; // All go to escrow first

      await client.query(
        `
        INSERT INTO maid_payouts (maid_id, booking_id, payment_id, amount, currency, status)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (booking_id) DO NOTHING
      `,
        [
          b.maid_id,
          b.booking_id,
          b.payment_id,
          payoutAmount,
          b.currency,
          status,
        ],
      );

      // Mark payment payout_status
      await client.query(
        `
        UPDATE payments SET payout_status = 'escrow' WHERE id = $1
      `,
        [b.payment_id],
      );

      console.log(
        `  ✅ ${b.maid_id.slice(0, 8)}… | ${b.currency} | ${payoutAmount.toFixed(2)} | ${status}`,
      );
      seeded++;
    }

    // Summary
    const { rows: summary } = await client.query(`
      SELECT currency, status, COUNT(*) as count, SUM(amount) as total
      FROM maid_payouts
      GROUP BY currency, status
      ORDER BY currency, status
    `);

    console.log("\n📊 maid_payouts summary:");
    for (const r of summary) {
      console.log(
        `  ${r.currency} | ${r.status} | ${r.count} records | ${Number(r.total).toFixed(2)}`,
      );
    }

    console.log(`\n✅ Seeded ${seeded} escrow record(s). Restart server.`);
  } catch (err) {
    console.error("❌ Failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
