// scripts/run-gift-certificate-migration.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  console.log("📦 Running gift_certificates table migration...");

  const client = await db.connect();

  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS gift_certificates (
        id SERIAL PRIMARY KEY,
        certificate_code VARCHAR(50) UNIQUE NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        from_name VARCHAR(255) NOT NULL,
        recipient_name VARCHAR(255) NOT NULL,
        recipient_email VARCHAR(255) NOT NULL,
        message TEXT,
        delivery_date DATE,
        occasion VARCHAR(100),
        status VARCHAR(50) DEFAULT 'pending',
        purchase_reference VARCHAR(100) UNIQUE,
        payment_method VARCHAR(50),
        transaction_id VARCHAR(100),
        redeemed_at TIMESTAMP,
        redeemed_by INTEGER,
        booking_id INTEGER,
        expires_at TIMESTAMP,
        admin_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_gift_certificates_code ON gift_certificates(certificate_code);
      CREATE INDEX IF NOT EXISTS idx_gift_certificates_email ON gift_certificates(recipient_email);
      CREATE INDEX IF NOT EXISTS idx_gift_certificates_status ON gift_certificates(status);
      CREATE INDEX IF NOT EXISTS idx_gift_certificates_created_at ON gift_certificates(created_at);
      CREATE INDEX IF NOT EXISTS idx_gift_certificates_expires_at ON gift_certificates(expires_at);
      
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
      
      DROP TRIGGER IF EXISTS update_gift_certificates_updated_at ON gift_certificates;
      CREATE TRIGGER update_gift_certificates_updated_at 
        BEFORE UPDATE ON gift_certificates 
        FOR EACH ROW 
        EXECUTE FUNCTION update_updated_at_column();
      
      COMMENT ON TABLE gift_certificates IS 'Stores gift certificate purchases for the platform';
    `;

    await client.query(sql);
    console.log("✅ Migration completed successfully!");

    // Verify
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'gift_certificates'
      );
    `);

    if (rows[0].exists) {
      console.log("✓ gift_certificates table exists and is ready");
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
