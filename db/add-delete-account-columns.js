// scripts/add-delete-account-columns.js
// Run with:  node scripts/add-delete-account-columns.js

import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

const migrations = [
  {
    desc: "Add deleted_at timestamp",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
  },
  {
    desc: "Add is_active flag (defaults to true for existing rows)",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true`,
  },
  {
    desc: "Add transaction_pin_hash",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS transaction_pin_hash TEXT`,
  },
  {
    desc: "Add pin_set_at",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_set_at TIMESTAMPTZ`,
  },
  {
    desc: "Add pin_failed_attempts",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_failed_attempts INTEGER NOT NULL DEFAULT 0`,
  },
  {
    desc: "Add pin_locked_until",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ`,
  },
  {
    desc: "Add reset_token",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT`,
  },
  {
    desc: "Add reset_token_expires",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ`,
  },
  {
    desc: "Create index on reset_token for fast lookups",
    sql: `CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users (reset_token) WHERE reset_token IS NOT NULL`,
  },
  {
    desc: "Create index on is_active for fast active-user queries",
    sql: `CREATE INDEX IF NOT EXISTS idx_users_is_active ON users (is_active)`,
  },
];

async function run() {
  await client.connect();
  console.log("✅ Connected to database\n");

  for (const { desc, sql } of migrations) {
    try {
      await client.query(sql);
      console.log(`✅  ${desc}`);
    } catch (err) {
      // IF NOT EXISTS makes most of these idempotent, but just in case:
      console.error(`❌  ${desc}\n    ${err.message}`);
    }
  }

  console.log("\n🎉 Migration complete.");
  await client.end();
}

run().catch(async (err) => {
  console.error("Fatal error:", err.message);
  await client.end();
  process.exit(1);
});
