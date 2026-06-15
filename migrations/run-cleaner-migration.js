// migrations/run-cleaner-migration.js
import pg from "pg";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  console.log("📦 Running cleaner_applications table migration...");

  const client = await db.connect();

  try {
    const sql = `
      -- Drop existing table if it exists (optional - remove if you want to keep data)
      -- DROP TABLE IF EXISTS cleaner_applications CASCADE;
      
      CREATE TABLE IF NOT EXISTS cleaner_applications (
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
      
      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_cleaner_applications_status ON cleaner_applications(status);
      CREATE INDEX IF NOT EXISTS idx_cleaner_applications_email ON cleaner_applications(email);
      CREATE INDEX IF NOT EXISTS idx_cleaner_applications_created_at ON cleaner_applications(created_at);
      CREATE INDEX IF NOT EXISTS idx_cleaner_applications_preferred_track ON cleaner_applications(preferred_track);
      CREATE INDEX IF NOT EXISTS idx_cleaner_applications_city ON cleaner_applications(city);
      
      -- Create updated_at trigger function if it doesn't exist
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
      
      -- Create trigger
      DROP TRIGGER IF EXISTS update_cleaner_applications_updated_at ON cleaner_applications;
      CREATE TRIGGER update_cleaner_applications_updated_at 
        BEFORE UPDATE ON cleaner_applications 
        FOR EACH ROW 
        EXECUTE FUNCTION update_updated_at_column();
      
      -- Comment on table
      COMMENT ON TABLE cleaner_applications IS 'Stores applications for Deusizi Academy Cleaner Training program';
    `;

    console.log("Executing SQL migration...");
    await client.query(sql);

    console.log("✅ Migration completed successfully!");

    // Verify table was created
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'cleaner_applications'
      );
    `);

    if (rows[0].exists) {
      console.log("✓ cleaner_applications table exists");

      // Show table structure
      const { rows: columns } = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'cleaner_applications'
        ORDER BY ordinal_position;
      `);
      console.log("\n📋 Table structure:");
      columns.forEach((col) => {
        console.log(`   - ${col.column_name}: ${col.data_type}`);
      });
    } else {
      console.log("✗ cleaner_applications table was not created");
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
