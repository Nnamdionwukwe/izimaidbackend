// scripts/addCryptoColumns.js
import pool from "../src/config/database.js";

async function addCryptoColumns() {
  console.log("🔄 Adding crypto columns to payments table...");

  try {
    // Use IF NOT EXISTS – works on PostgreSQL 9.6+
    const queries = [
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS crypto_currency VARCHAR(10)`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS crypto_address TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS crypto_tx_hash TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS crypto_proof_url TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS crypto_amount_sent DECIMAL(10,2)`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS crypto_status VARCHAR(20) DEFAULT 'pending'`,
    ];

    for (const sql of queries) {
      await pool.query(sql);
      console.log(`✅ Executed: ${sql}`);
    }

    console.log("✅ All crypto columns added (or already existed).");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
    console.log("🔌 Database connection closed.");
  }
}

addCryptoColumns();
