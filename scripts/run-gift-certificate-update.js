// scripts/run-gift-certificate-update.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  console.log("📦 Adding recipient_phone column to gift_certificates...");

  const client = await db.connect();

  try {
    // Check if column already exists
    const { rows } = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'gift_certificates' AND column_name = 'recipient_phone'
    `);

    if (rows.length > 0) {
      console.log("✅ recipient_phone column already exists");
    } else {
      // Add the column
      await client.query(`
        ALTER TABLE gift_certificates 
        ADD COLUMN recipient_phone VARCHAR(20)
      `);

      // Add comment
      await client.query(`
        COMMENT ON COLUMN gift_certificates.recipient_phone IS 'Phone number of the gift certificate recipient'
      `);

      console.log("✅ recipient_phone column added successfully");
    }

    // Verify column exists
    const { rows: verifyRows } = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'gift_certificates' AND column_name = 'recipient_phone'
    `);

    if (verifyRows.length > 0) {
      console.log(
        `✓ Column added: ${verifyRows[0].column_name} (${verifyRows[0].data_type})`,
      );
    }
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

runMigration().catch(console.error);
