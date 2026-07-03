// scripts/seedCryptoColumns.js
import pool from "../src/config/database.js";

async function addCryptoColumns() {
  console.log("🔄 Starting migration: add crypto columns to payments table...");

  try {
    // Check which columns already exist
    const checkQuery = `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'payments'
        AND column_name IN (
          'crypto_currency',
          'crypto_address',
          'crypto_tx_hash',
          'crypto_proof_url',
          'crypto_amount_sent',
          'crypto_status'
        );
    `;
    const { rows } = await pool.query(checkQuery);
    const existingColumns = rows.map((r) => r.column_name);

    const columnsToAdd = [];

    if (!existingColumns.includes("crypto_currency")) {
      columnsToAdd.push("ADD COLUMN crypto_currency VARCHAR(10)");
    }
    if (!existingColumns.includes("crypto_address")) {
      columnsToAdd.push("ADD COLUMN crypto_address TEXT");
    }
    if (!existingColumns.includes("crypto_tx_hash")) {
      columnsToAdd.push("ADD COLUMN crypto_tx_hash TEXT");
    }
    if (!existingColumns.includes("crypto_proof_url")) {
      columnsToAdd.push("ADD COLUMN crypto_proof_url TEXT");
    }
    if (!existingColumns.includes("crypto_amount_sent")) {
      columnsToAdd.push("ADD COLUMN crypto_amount_sent DECIMAL(10,2)");
    }
    if (!existingColumns.includes("crypto_status")) {
      columnsToAdd.push(
        "ADD COLUMN crypto_status VARCHAR(20) DEFAULT 'pending'",
      );
    }

    if (columnsToAdd.length === 0) {
      console.log("✅ All crypto columns already exist. Nothing to do.");
      await pool.end();
      return;
    }

    const alterSQL = `
      ALTER TABLE payments
      ${columnsToAdd.join(",\n")};
    `;

    console.log(
      `📝 Adding columns: ${columnsToAdd.map((c) => c.replace("ADD COLUMN ", "")).join(", ")}`,
    );
    await pool.query(alterSQL);
    console.log("✅ Migration completed successfully.");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
    console.log("🔌 Database connection closed.");
  }
}

// Run the migration
addCryptoColumns();
