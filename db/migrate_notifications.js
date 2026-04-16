// db/migrate_notifications.js
import pg from "pg";
const pool = new pg.Pool({
  connectionString:
    "postgresql://postgres:lFTWaNFqrAsULGNgOuwhZkrdjAIlHIMq@centerbeam.proxy.rlwy.net:46630/railway",
  ssl: false,
});
async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type       text NOT NULL,
        title      text NOT NULL,
        body       text NOT NULL,
        data       jsonb DEFAULT '{}',
        is_read    boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user
      ON notifications(user_id, is_read, created_at DESC)
    `);
    console.log("✓ notifications: table ready");
  } finally {
    client.release();
    await pool.end();
  }
}
run().catch(console.error);
