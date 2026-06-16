// scripts/run-foundation-migration.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  console.log("📦 Running foundation_donations table migration...");

  const client = await db.connect();

  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS foundation_donations (
        id SERIAL PRIMARY KEY,
        donor_name VARCHAR(255) NOT NULL,
        donor_email VARCHAR(255) NOT NULL,
        donor_message TEXT,
        amount DECIMAL(10, 2) NOT NULL,
        donation_type VARCHAR(20) DEFAULT 'once',
        status VARCHAR(50) DEFAULT 'pending',
        payment_reference VARCHAR(100) UNIQUE,
        payment_method VARCHAR(50),
        transaction_id VARCHAR(100),
        admin_notes TEXT,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_foundation_donations_status ON foundation_donations(status);
      CREATE INDEX IF NOT EXISTS idx_foundation_donations_email ON foundation_donations(donor_email);
      CREATE INDEX IF NOT EXISTS idx_foundation_donations_created_at ON foundation_donations(created_at);
      CREATE INDEX IF NOT EXISTS idx_foundation_donations_donation_type ON foundation_donations(donation_type);
      
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
      
      DROP TRIGGER IF EXISTS update_foundation_donations_updated_at ON foundation_donations;
      CREATE TRIGGER update_foundation_donations_updated_at 
        BEFORE UPDATE ON foundation_donations 
        FOR EACH ROW 
        EXECUTE FUNCTION update_updated_at_column();
      
      COMMENT ON TABLE foundation_donations IS 'Stores donations made to the Deusizi Foundation';
    `;

    await client.query(sql);
    console.log("✅ Migration completed successfully!");

    // Verify
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'foundation_donations'
      );
    `);

    if (rows[0].exists) {
      console.log("✓ foundation_donations table exists and is ready");
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
