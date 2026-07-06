// scripts/alter-payments-booking-id-null.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  console.log("🔧 Altering payments.booking_id to allow NULL...");

  const client = await db.connect();

  try {
    // Check current constraint
    const { rows: constraintCheck } = await client.query(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_name = 'payments'
        AND column_name = 'booking_id'
    `);

    if (constraintCheck.length === 0) {
      console.log("❌ Column 'booking_id' not found in payments table.");
      return;
    }

    if (constraintCheck[0].is_nullable === "YES") {
      console.log("✅ Column already allows NULL. No action needed.");
      return;
    }

    // Alter column to allow NULL
    const sql = `
      ALTER TABLE payments
      ALTER COLUMN booking_id DROP NOT NULL;
    `;

    await client.query(sql);
    console.log("✅ Successfully altered booking_id to allow NULL.");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

runMigration().catch(console.error);
