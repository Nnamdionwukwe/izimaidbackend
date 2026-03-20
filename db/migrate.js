import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

async function run() {
  const client = await pool.connect();
  try {
    // Add awaiting_payment to booking_status enum if it doesn't exist
    await client.query(`
      ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'awaiting_payment'
    `);
    console.log("✓ 'awaiting_payment' added to booking_status enum");

    // Also add declined in case it's missing
    await client.query(`
      ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'declined'
    `);
    console.log("✓ 'declined' added to booking_status enum");

    // Verify all current enum values
    const { rows } = await client.query(`
      SELECT enumlabel FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      WHERE pg_type.typname = 'booking_status'
      ORDER BY enumsortorder
    `);
    console.log("\n✓ Current booking_status values:");
    rows.forEach((r) => console.log("  -", r.enumlabel));
  } catch (err) {
    console.error("✗ Failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
