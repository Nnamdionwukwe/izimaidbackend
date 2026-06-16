// scripts/run-shelter-migration.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  console.log("📦 Running shelter_applications table migration...");

  const client = await db.connect();

  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS shelter_applications (
        id SERIAL PRIMARY KEY,
        organisation_name VARCHAR(255) NOT NULL,
        contact_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        city VARCHAR(100) NOT NULL,
        organisation_type VARCHAR(100),
        support_type VARCHAR(100) NOT NULL,
        resident_count VARCHAR(50),
        message TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        admin_notes TEXT,
        reviewed_at TIMESTAMP,
        reviewed_by VARCHAR(255),
        reference_number VARCHAR(50) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_shelter_applications_status ON shelter_applications(status);
      CREATE INDEX IF NOT EXISTS idx_shelter_applications_email ON shelter_applications(email);
      CREATE INDEX IF NOT EXISTS idx_shelter_applications_created_at ON shelter_applications(created_at);
      CREATE INDEX IF NOT EXISTS idx_shelter_applications_city ON shelter_applications(city);
      CREATE INDEX IF NOT EXISTS idx_shelter_applications_support_type ON shelter_applications(support_type);
      
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
      
      DROP TRIGGER IF EXISTS update_shelter_applications_updated_at ON shelter_applications;
      CREATE TRIGGER update_shelter_applications_updated_at 
        BEFORE UPDATE ON shelter_applications 
        FOR EACH ROW 
        EXECUTE FUNCTION update_updated_at_column();
      
      COMMENT ON TABLE shelter_applications IS 'Stores applications for local shelter and agency support partnerships';
    `;

    await client.query(sql);
    console.log("✅ Migration completed successfully!");

    // Verify
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'shelter_applications'
      );
    `);

    if (rows[0].exists) {
      console.log("✓ shelter_applications table exists and is ready");
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
