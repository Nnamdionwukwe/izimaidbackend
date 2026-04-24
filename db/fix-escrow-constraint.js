// db/fix-escrow-constraint.js
import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    "postgresql://postgres:lFTWaNFqrAsULGNgOuwhZkrdjAIlHIMq@centerbeam.proxy.rlwy.net:46630/railway",
  ssl: false,
});

const client = await pool.connect();
try {
  // Show current constraints on maid_payouts
  const { rows } = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE conrelid = 'maid_payouts'::regclass
  `);
  console.log(
    "Current constraints:",
    rows.map((r) => r.conname),
  );

  // Add unique constraint on booking_id if missing
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'maid_payouts'::regclass
          AND contype IN ('u','p')
          AND conname = 'maid_payouts_booking_id_key'
      ) THEN
        ALTER TABLE maid_payouts ADD CONSTRAINT maid_payouts_booking_id_key UNIQUE (booking_id);
        RAISE NOTICE 'Added UNIQUE(booking_id)';
      ELSE
        RAISE NOTICE 'Constraint already exists';
      END IF;
    END $$
  `);
  console.log("✅ UNIQUE(booking_id) ensured");
} finally {
  client.release();
  await pool.end();
}
