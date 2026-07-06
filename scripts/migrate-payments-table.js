// scripts/migrate-payments-table.js
import pkg from "pg";
const { Pool } = pkg;
import dotenv from "dotenv";

// Load environment variables from .env file (if any)
dotenv.config();

// Use DATABASE_URL from environment
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("❌ DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log("🔍 Checking payments table structure...");

    // Check if columns exist
    const { rows: existingColumns } = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'payments'
    `);

    const columnNames = existingColumns.map((row) => row.column_name);

    const columnsToAdd = [];

    if (!columnNames.includes("flutterwave_tx_ref")) {
      columnsToAdd.push("flutterwave_tx_ref VARCHAR(255)");
    }
    if (!columnNames.includes("flutterwave_payment_id")) {
      columnsToAdd.push("flutterwave_payment_id VARCHAR(255)");
    }
    if (!columnNames.includes("notes")) {
      columnsToAdd.push("notes TEXT");
    }

    if (columnsToAdd.length === 0) {
      console.log(
        "✅ All required columns already exist. No migration needed.",
      );
      return;
    }

    console.log(`📦 Adding columns: ${columnsToAdd.join(", ")}`);

    for (const colDef of columnsToAdd) {
      const sql = `ALTER TABLE payments ADD COLUMN IF NOT EXISTS ${colDef};`;
      await client.query(sql);
      console.log(`✅ Added column: ${colDef}`);
    }

    console.log("✅ Migration completed successfully.");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch(() => process.exit(1));
