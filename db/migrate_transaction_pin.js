// db/migrate_transaction_pin.js
import pg from "pg";
const pool = new pg.Pool({
  connectionString:
    "postgresql://postgres:lFTWaNFqrAsULGNgOuwhZkrdjAIlHIMq@centerbeam.proxy.rlwy.net:46630/railway",
  ssl: false,
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS transaction_pin_hash  text,
        ADD COLUMN IF NOT EXISTS pin_set_at            timestamptz,
        ADD COLUMN IF NOT EXISTS pin_failed_attempts   integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS pin_locked_until      timestamptz
    `);
    console.log("✓ users: transaction PIN fields added");

    // Pin attempt log for audit
    await client.query(`
      CREATE TABLE IF NOT EXISTS pin_attempts (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        success    boolean NOT NULL,
        ip_address text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pin_attempts_user
        ON pin_attempts(user_id, created_at DESC)
    `);
    console.log("✓ pin_attempts: table created");

    await client.query("COMMIT");
    console.log("✅ Transaction PIN migration complete");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("✗ Failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
run().catch(console.error);
