// scripts/run-domestic-certification-migration.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  console.log(
    "📦 Running domestic_certification_applications table migration...",
  );

  const client = await db.connect();

  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS domestic_certification_applications (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        city VARCHAR(255) NOT NULL,
        program_choice VARCHAR(255) NOT NULL,
        experience_level VARCHAR(50),
        education_level VARCHAR(50),
        previous_training TEXT,
        schedule_preference VARCHAR(100),
        start_month VARCHAR(50),
        motivation TEXT NOT NULL,
        referral_code VARCHAR(100),
        hear_about VARCHAR(100),
        emergency_contact VARCHAR(255),
        emergency_phone VARCHAR(50),
        status VARCHAR(50) DEFAULT 'pending',
        admin_notes TEXT,
        application_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TIMESTAMP,
        reviewed_by INTEGER,
        reference_number VARCHAR(50) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_domestic_applications_status ON domestic_certification_applications(status);
      CREATE INDEX IF NOT EXISTS idx_domestic_applications_email ON domestic_certification_applications(email);
      CREATE INDEX IF NOT EXISTS idx_domestic_applications_created_at ON domestic_certification_applications(created_at);
      CREATE INDEX IF NOT EXISTS idx_domestic_applications_program_choice ON domestic_certification_applications(program_choice);
      CREATE INDEX IF NOT EXISTS idx_domestic_applications_city ON domestic_certification_applications(city);
      
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
      
      DROP TRIGGER IF EXISTS update_domestic_applications_updated_at ON domestic_certification_applications;
      CREATE TRIGGER update_domestic_applications_updated_at 
        BEFORE UPDATE ON domestic_certification_applications 
        FOR EACH ROW 
        EXECUTE FUNCTION update_updated_at_column();
      
      COMMENT ON TABLE domestic_certification_applications IS 'Stores applications for Deusizi Academy Domestic Staff Certification programs';
    `;

    await client.query(sql);
    console.log("✅ Migration completed successfully!");

    // Verify
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'domestic_certification_applications'
      );
    `);

    if (rows[0].exists) {
      console.log(
        "✓ domestic_certification_applications table exists and is ready",
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
