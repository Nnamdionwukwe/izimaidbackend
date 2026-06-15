// scripts/run-housekeeper-migration.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  console.log("📦 Running housekeeper_applications table migration...");

  const client = await db.connect();

  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS housekeeper_applications (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        city VARCHAR(100) NOT NULL,
        preferred_track VARCHAR(255) NOT NULL,
        experience_level VARCHAR(50),
        motivation TEXT NOT NULL,
        availability TEXT[] DEFAULT '{}',
        status VARCHAR(50) DEFAULT 'pending',
        admin_notes TEXT,
        application_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TIMESTAMP,
        reviewed_by INTEGER,
        reference_number VARCHAR(50) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_housekeeper_applications_status ON housekeeper_applications(status);
      CREATE INDEX IF NOT EXISTS idx_housekeeper_applications_email ON housekeeper_applications(email);
      CREATE INDEX IF NOT EXISTS idx_housekeeper_applications_created_at ON housekeeper_applications(created_at);
      CREATE INDEX IF NOT EXISTS idx_housekeeper_applications_preferred_track ON housekeeper_applications(preferred_track);
      CREATE INDEX IF NOT EXISTS idx_housekeeper_applications_city ON housekeeper_applications(city);
      
      COMMENT ON TABLE housekeeper_applications IS 'Stores applications for Deusizi Academy Housekeeper Training program';
    `;

    await client.query(sql);
    console.log("✅ Migration completed successfully!");

    // Verify
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'housekeeper_applications'
      );
    `);

    if (rows[0].exists) {
      console.log("✓ housekeeper_applications table exists and is ready");
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
