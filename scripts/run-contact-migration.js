// scripts/run-contact-migration.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  console.log("📦 Running contact_messages table migration...");

  const client = await db.connect();

  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS contact_messages (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        subject VARCHAR(100) NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'new',
        admin_notes TEXT,
        replied_at TIMESTAMP,
        replied_by VARCHAR(255),
        reference_number VARCHAR(50) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages(status);
      CREATE INDEX IF NOT EXISTS idx_contact_messages_email ON contact_messages(email);
      CREATE INDEX IF NOT EXISTS idx_contact_messages_created_at ON contact_messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_contact_messages_subject ON contact_messages(subject);
      
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
      
      DROP TRIGGER IF EXISTS update_contact_messages_updated_at ON contact_messages;
      CREATE TRIGGER update_contact_messages_updated_at 
        BEFORE UPDATE ON contact_messages 
        FOR EACH ROW 
        EXECUTE FUNCTION update_updated_at_column();
      
      COMMENT ON TABLE contact_messages IS 'Stores contact form submissions from users';
    `;

    await client.query(sql);
    console.log("✅ Migration completed successfully!");

    // Verify
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'contact_messages'
      );
    `);

    if (rows[0].exists) {
      console.log("✓ contact_messages table exists and is ready");
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
