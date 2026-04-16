// db/migrate_bookings_v2.js
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

    // ── Bookings: rate_type + video call token ────────────────────
    await client.query(`
      ALTER TABLE bookings
        ADD COLUMN IF NOT EXISTS rate_type          text NOT NULL DEFAULT 'hourly',
        ADD COLUMN IF NOT EXISTS video_call_room    text,
        ADD COLUMN IF NOT EXISTS video_call_token   text,
        ADD COLUMN IF NOT EXISTS video_call_status  text DEFAULT 'none',
        ADD COLUMN IF NOT EXISTS maid_accepted_at   timestamptz,
        ADD COLUMN IF NOT EXISTS live_tracking_on   boolean NOT NULL DEFAULT false
    `);
    console.log("✓ bookings: rate_type, video call, live tracking");

    // ── Emergency contacts ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS emergency_contacts (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name         text NOT NULL,
        phone        text NOT NULL,
        relationship text NOT NULL DEFAULT 'other',
        is_primary   boolean NOT NULL DEFAULT false,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user 
      ON emergency_contacts(user_id)
    `);
    console.log("✓ emergency_contacts: table created");

    // ── SOS alerts ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS sos_alerts (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id   uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        triggered_by uuid NOT NULL REFERENCES users(id),
        lat          numeric(9,6),
        lng          numeric(9,6),
        address      text,
        message      text,
        status       text NOT NULL DEFAULT 'active',  -- 'active','resolved'
        resolved_by  uuid REFERENCES users(id),
        resolved_at  timestamptz,
        created_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sos_alerts_booking 
      ON sos_alerts(booking_id);
      CREATE INDEX IF NOT EXISTS idx_sos_alerts_status 
      ON sos_alerts(status, created_at DESC)
    `);
    console.log("✓ sos_alerts: table created");

    // ── Live location updates ─────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS booking_locations (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        maid_id     uuid NOT NULL REFERENCES users(id),
        lat         numeric(9,6) NOT NULL,
        lng         numeric(9,6) NOT NULL,
        accuracy    numeric(8,2),
        recorded_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Only keep last 100 location pings per booking — old ones auto-pruned by app
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_booking_locations_booking 
      ON booking_locations(booking_id, recorded_at DESC)
    `);
    console.log("✓ booking_locations: table created");

    await client.query("COMMIT");
    console.log("\n✅ Bookings v2 migrations complete");
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
