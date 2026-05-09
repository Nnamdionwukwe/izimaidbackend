import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function run() {
  await client.connect();
  console.log("Connected to database...");

  // 1. Add column if it doesn't exist
  await client.query(`
    ALTER TABLE maid_profiles 
    ADD COLUMN IF NOT EXISTS completed_bookings INTEGER DEFAULT 0
  `);
  console.log("✅ Column added (or already existed)");

  // 2. Backfill from real bookings data
  const { rowCount } = await client.query(`
    UPDATE maid_profiles mp
    SET completed_bookings = (
      SELECT COUNT(*) FROM bookings b
      WHERE b.maid_id = mp.user_id
      AND b.status = 'completed'
    )
  `);
  console.log(`✅ Backfilled ${rowCount} maid profiles`);

  await client.end();
  console.log("Done!");
}

run().catch((err) => {
  console.error("Migration failed:", err);
  client.end();
  process.exit(1);
});
