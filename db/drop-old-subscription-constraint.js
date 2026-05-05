// Drops the old unique constraint and adds a safer partial unique index
// Run: node db/drop-old-subscription-constraint.js

import { config } from "dotenv";
config();

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const masked = process.env.DATABASE_URL?.replace(/:([^:@]{4,})@/, ":****@");
console.log("→ Connecting to:", masked);

async function run() {
  const client = await pool.connect();
  console.log("✓ Connected to database");

  try {
    await client.query("BEGIN");

    console.log("🚫 Dropping old constraint/index...");
    await client.query(`
      ALTER TABLE public.subscriptions
      DROP CONSTRAINT IF EXISTS "subscriptions_user_id_status_key";
    `);

    await client.query(`
      DROP INDEX IF EXISTS subscriptions_user_id_status_key;
    `);

    console.log("✅ Removed old unique constraint.");

    console.log("🧩 Creating partial unique index for only active subs...");
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_sub_per_user
      ON public.subscriptions (user_id)
      WHERE status = 'active';
    `);

    await client.query("COMMIT");
    console.log("✅ Schema updated — multiple cancelled subs now allowed.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Migration failed:", err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
