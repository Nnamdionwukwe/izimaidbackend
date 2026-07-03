// migrations/add-flutterwave-columns.js
import pool from "../src/config/database.js";

async function addFlutterwaveColumns() {
  console.log(
    "🔄 Starting migration: add Flutterwave columns to payments table...",
  );

  try {
    // Check if columns already exist (optional, but safe)
    const checkQuery = `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'payments'
        AND column_name IN ('flutterwave_tx_ref', 'flutterwave_payment_id', 'flutterwave_transaction_id');
    `;
    const { rows } = await pool.query(checkQuery);
    const existingColumns = rows.map((r) => r.column_name);

    const columnsToAdd = [];
    if (!existingColumns.includes("flutterwave_tx_ref")) {
      columnsToAdd.push("ADD COLUMN flutterwave_tx_ref VARCHAR(255)");
    }
    if (!existingColumns.includes("flutterwave_payment_id")) {
      columnsToAdd.push("ADD COLUMN flutterwave_payment_id VARCHAR(255)");
    }
    if (!existingColumns.includes("flutterwave_transaction_id")) {
      columnsToAdd.push("ADD COLUMN flutterwave_transaction_id VARCHAR(255)");
    }

    if (columnsToAdd.length === 0) {
      console.log("✅ All Flutterwave columns already exist. Nothing to do.");
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
    // Close the pool to exit the script
    await pool.end();
    console.log("🔌 Database connection closed.");
  }
}

// Run the migration
addFlutterwaveColumns();
