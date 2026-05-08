// scripts/add-escrow.js
// Run with: node scripts/add-escrow.js

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
    desc: "Add escrow_status to bookings",
    sql: `ALTER TABLE bookings
          ADD COLUMN IF NOT EXISTS escrow_status TEXT DEFAULT 'none'
            CHECK (escrow_status IN ('none','pending_release','released','auto_released'))`,
  },
  {
    desc: "Add escrow_released_at timestamp",
    sql: `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS escrow_released_at TIMESTAMPTZ`,
  },
  {
    desc: "Add escrow_released_by (customer user id)",
    sql: `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS escrow_released_by UUID REFERENCES users(id)`,
  },
  {
    desc: "Index on escrow_status for pending queries",
    sql: `CREATE INDEX IF NOT EXISTS idx_bookings_escrow_status ON bookings (escrow_status)`,
  },
  // Backfill — existing completed bookings that were already credited get 'released'
  {
    desc: "Backfill completed bookings as already released",
    sql: `UPDATE bookings SET escrow_status = 'released'
          WHERE status = 'completed' AND escrow_status = 'none'`,
  },
];

async function run() {
  await client.connect();
  console.log("✅ Connected\n");
  for (const { desc, sql } of migrations) {
    try {
      await client.query(sql);
      console.log(`✅  ${desc}`);
    } catch (err) {
      console.error(`❌  ${desc}\n    ${err.message}`);
    }
  }
  console.log("\n🎉 Done.");
  await client.end();
}
run().catch(async (err) => {
  console.error(err.message);
  await client.end();
  process.exit(1);
});
