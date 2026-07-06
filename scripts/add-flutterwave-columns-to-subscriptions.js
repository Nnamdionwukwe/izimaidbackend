// scripts/add-flutterwave-columns-to-subscriptions.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  console.log("📦 Adding Flutterwave columns to subscriptions table...");

  const client = await db.connect();

  try {
    // Check if columns already exist
    const { rows: existingColumns } = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'subscriptions'
    `);

    const columnNames = existingColumns.map((row) => row.column_name);
    const columnsToAdd = [];

    if (!columnNames.includes("flutterwave_tx_ref")) {
      columnsToAdd.push("flutterwave_tx_ref VARCHAR(255)");
    }
    if (!columnNames.includes("flutterwave_transaction_id")) {
      columnsToAdd.push("flutterwave_transaction_id VARCHAR(255)");
    }

    if (columnsToAdd.length === 0) {
      console.log(
        "✅ All required columns already exist. No migration needed.",
      );
      return;
    }

    console.log(`📦 Adding columns: ${columnsToAdd.join(", ")}`);

    for (const colDef of columnsToAdd) {
      const sql = `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS ${colDef};`;
      await client.query(sql);
      console.log(`✅ Added column: ${colDef}`);
    }

    console.log("✅ Migration completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

runMigration().catch(console.error);
