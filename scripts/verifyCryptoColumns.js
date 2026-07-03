// scripts/verifyCryptoColumns.js
import pool from "../src/config/database.js";

async function verify() {
  console.log("🔍 Checking crypto columns in payments table...");

  try {
    // 1. Show which database we're connected to
    const dbRes = await pool.query("SELECT current_database() AS db");
    console.log(`📌 Connected to database: ${dbRes.rows[0].db}`);

    // 2. List existing crypto columns
    const colRes = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'payments'
        AND column_name LIKE 'crypto_%'
    `);
    const existing = colRes.rows.map((r) => r.column_name);
    console.log(
      `📋 Existing crypto columns: ${existing.length ? existing.join(", ") : "NONE"}`,
    );

    // 3. If any are missing, add them
    const expected = [
      "crypto_currency",
      "crypto_address",
      "crypto_tx_hash",
      "crypto_proof_url",
      "crypto_amount_sent",
      "crypto_status",
    ];
    const missing = expected.filter((col) => !existing.includes(col));

    if (missing.length === 0) {
      console.log("✅ All crypto columns exist. Your app should work.");
    } else {
      console.log(`❌ Missing columns: ${missing.join(", ")}`);
      console.log("🔄 Attempting to add them now...");
      for (const col of missing) {
        let type;
        switch (col) {
          case "crypto_currency":
            type = "VARCHAR(10)";
            break;
          case "crypto_address":
            type = "TEXT";
            break;
          case "crypto_tx_hash":
            type = "TEXT";
            break;
          case "crypto_proof_url":
            type = "TEXT";
            break;
          case "crypto_amount_sent":
            type = "DECIMAL(10,2)";
            break;
          case "crypto_status":
            type = "VARCHAR(20) DEFAULT 'pending'";
            break;
        }
        await pool.query(
          `ALTER TABLE payments ADD COLUMN IF NOT EXISTS ${col} ${type}`,
        );
        console.log(`  ✅ Added ${col}`);
      }
      console.log("✅ All columns are now present. Restart your app.");
    }
  } catch (err) {
    console.error("❌ Error:", err.message);
  } finally {
    await pool.end();
  }
}

verify();
