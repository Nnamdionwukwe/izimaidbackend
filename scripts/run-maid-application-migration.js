// scripts/run-maid-application-migration.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  console.log("📦 Running maid_applications table migration...");

  const client = await db.connect();

  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS maid_applications (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        city VARCHAR(100) NOT NULL,
        experience_level VARCHAR(50),
        services TEXT[] DEFAULT '{}',
        message TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        admin_notes TEXT,
        reviewed_at TIMESTAMP,
        reviewed_by VARCHAR(255),
        reference_number VARCHAR(50) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_maid_applications_status ON maid_applications(status);
      CREATE INDEX IF NOT EXISTS idx_maid_applications_email ON maid_applications(email);
      CREATE INDEX IF NOT EXISTS idx_maid_applications_created_at ON maid_applications(created_at);
      CREATE INDEX IF NOT EXISTS idx_maid_applications_city ON maid_applications(city);
      
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
      
      DROP TRIGGER IF EXISTS update_maid_applications_updated_at ON maid_applications;
      CREATE TRIGGER update_maid_applications_updated_at 
        BEFORE UPDATE ON maid_applications 
        FOR EACH ROW 
        EXECUTE FUNCTION update_updated_at_column();
      
      COMMENT ON TABLE maid_applications IS 'Stores maid applications from users wanting to join the platform';
    `;

    await client.query(sql);
    console.log("✅ Migration completed successfully!");

    // Verify
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'maid_applications'
      );
    `);

    if (rows[0].exists) {
      console.log("✓ maid_applications table exists and is ready");
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
