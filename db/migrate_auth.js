// db/migrate_auth.js
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

    // ── users: password + email verification + reset ─────────────
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS password_hash         text,
        ADD COLUMN IF NOT EXISTS email_verified        boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS email_verify_token    text,
        ADD COLUMN IF NOT EXISTS email_verify_expires  timestamptz,
        ADD COLUMN IF NOT EXISTS reset_token           text,
        ADD COLUMN IF NOT EXISTS reset_token_expires   timestamptz,
        ADD COLUMN IF NOT EXISTS auth_provider         text NOT NULL DEFAULT 'google'
    `);
    // Google users are auto-verified
    await client.query(`
      UPDATE users SET email_verified = true, auth_provider = 'google'
      WHERE google_id IS NOT NULL AND email_verified = false
    `);
    console.log(
      "✓ users: added password, email verification, reset token fields",
    );

    // ── user_devices: trusted device tracking ────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_devices (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_hash  text NOT NULL,
        user_agent   text,
        ip_address   text,
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        created_at   timestamptz NOT NULL DEFAULT now(),
        UNIQUE(user_id, device_hash)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_devices_user 
      ON user_devices(user_id, device_hash)
    `);
    console.log("✓ user_devices: table created");

    await client.query("COMMIT");
    console.log("\n✅ Auth migrations complete");
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
