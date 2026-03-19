// ONE-SHOT migration — adds soft-delete columns to messages table
// Run with: node db/add-message-soft-delete.js
// Safe to run multiple times (uses ADD COLUMN IF NOT EXISTS)

import { config } from "dotenv";
config();

import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const masked = process.env.DATABASE_URL?.replace(/:([^:@]{4,})@/, ":****@");
console.log("→ Connecting to:", masked);

async function run() {
  const client = await pool.connect();
  console.log("✓ Connected");

  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id)
    `);
    console.log("✓ deleted_at, deleted_by columns added to messages");

    // Also add conversation soft-delete columns in case they're missing too
    await client.query(`
      ALTER TABLE conversations
        ADD COLUMN IF NOT EXISTS deleted_by_customer  BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS deleted_by_maid      BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS deleted_at_customer  TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS deleted_at_maid      TIMESTAMP WITH TIME ZONE
    `);
    console.log("✓ soft-delete columns added to conversations");

    await client.query("COMMIT");

    // Verify
    const check = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'messages'
        AND column_name IN ('deleted_at', 'deleted_by')
      ORDER BY column_name
    `);
    console.log(
      "✓ Verified columns:",
      check.rows.map((r) => r.column_name).join(", "),
    );
    console.log(
      "\n✅ Migration complete — message delete will now soft-delete",
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n❌ Migration failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
