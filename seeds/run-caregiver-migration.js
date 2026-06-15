// scripts/run-caregiver-migration.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  console.log("📦 Running caregiver_applications table migration...");

  const client = await db.connect();

  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS caregiver_applications (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        city VARCHAR(100) NOT NULL,
        preferred_course VARCHAR(255) NOT NULL,
        experience_level VARCHAR(50),
        motivation TEXT NOT NULL,
        schedule_preference VARCHAR(100),
        status VARCHAR(50) DEFAULT 'pending',
        admin_notes TEXT,
        application_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TIMESTAMP,
        reviewed_by INTEGER,
        reference_number VARCHAR(50) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_caregiver_applications_status ON caregiver_applications(status);
      CREATE INDEX IF NOT EXISTS idx_caregiver_applications_email ON caregiver_applications(email);
      CREATE INDEX IF NOT EXISTS idx_caregiver_applications_created_at ON caregiver_applications(created_at);
      CREATE INDEX IF NOT EXISTS idx_caregiver_applications_preferred_course ON caregiver_applications(preferred_course);
      CREATE INDEX IF NOT EXISTS idx_caregiver_applications_city ON caregiver_applications(city);
      
      COMMENT ON TABLE caregiver_applications IS 'Stores applications for Deusizi Academy Caregiver Training program';
    `;

    await client.query(sql);
    console.log("✅ Migration completed successfully!");

    // Verify
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'caregiver_applications'
      );
    `);

    if (rows[0].exists) {
      console.log("✓ caregiver_applications table exists and is ready");
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
