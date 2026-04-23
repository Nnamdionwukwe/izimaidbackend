// scripts/fix-wallet-tx-columns.js
// node --env-file=.env scripts/fix-wallet-tx-columns.js

import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const client = await pool.connect();
try {
  const cols = [
    `ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS reference     TEXT`,
    `ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS booking_id    UUID`,
    `ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS withdrawal_id UUID`,
    `ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS balance_after NUMERIC(14,2)`,
    `ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS description   TEXT`,
  ];
  for (const sql of cols) {
    await client.query(sql);
    console.log("✅", sql.match(/ADD COLUMN IF NOT EXISTS (\w+)/)[1]);
  }
  console.log("\n✅ Done — restart server");
} catch (err) {
  console.error("❌", err.message);
} finally {
  client.release();
  await pool.end();
}
