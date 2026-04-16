// scripts/migrate_global.js
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

    // ── Users: international fields ──────────────────────────────
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS phone        text,
        ADD COLUMN IF NOT EXISTS country      text DEFAULT 'NG',
        ADD COLUMN IF NOT EXISTS language     text DEFAULT 'en',
        ADD COLUMN IF NOT EXISTS timezone     text DEFAULT 'Africa/Lagos',
        ADD COLUMN IF NOT EXISTS last_seen_at timestamptz
    `);
    console.log(
      "✓ users: added phone, country, language, timezone, last_seen_at",
    );

    // ── Maid profiles: geo + currency + stripe ───────────────────
    await client.query(`
      ALTER TABLE maid_profiles
        ADD COLUMN IF NOT EXISTS latitude           numeric(9,6),
        ADD COLUMN IF NOT EXISTS longitude          numeric(9,6),
        ADD COLUMN IF NOT EXISTS currency           text DEFAULT 'NGN',
        ADD COLUMN IF NOT EXISTS stripe_account_id text,
        ADD COLUMN IF NOT EXISTS id_verified        boolean DEFAULT false,
        ADD COLUMN IF NOT EXISTS background_checked boolean DEFAULT false,
        ADD COLUMN IF NOT EXISTS languages          text[]  DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS max_distance_km    integer DEFAULT 20
    `);
    console.log(
      "✓ maid_profiles: added geo, currency, stripe, verification flags",
    );

    // ── Payments: multi-currency + Stripe support ────────────────
    await client.query(`
      ALTER TABLE payments
        ADD COLUMN IF NOT EXISTS currency           text DEFAULT 'NGN',
        ADD COLUMN IF NOT EXISTS stripe_payment_id  text,
        ADD COLUMN IF NOT EXISTS stripe_session_id  text,
        ADD COLUMN IF NOT EXISTS gateway            text DEFAULT 'paystack',
        ADD COLUMN IF NOT EXISTS platform_fee       numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS maid_payout        numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS payout_status      text    DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS payout_at          timestamptz
    `);
    console.log("✓ payments: added multi-currency, stripe, payout tracking");

    // ── Bookings: recurring + cancellation ───────────────────────
    await client.query(`
      ALTER TABLE bookings
        ADD COLUMN IF NOT EXISTS is_recurring       boolean DEFAULT false,
        ADD COLUMN IF NOT EXISTS recurrence_rule    text,
        ADD COLUMN IF NOT EXISTS cancelled_by       text,
        ADD COLUMN IF NOT EXISTS cancelled_reason   text,
        ADD COLUMN IF NOT EXISTS cancelled_at       timestamptz,
        ADD COLUMN IF NOT EXISTS checkin_at         timestamptz,
        ADD COLUMN IF NOT EXISTS checkout_at        timestamptz,
        ADD COLUMN IF NOT EXISTS checkin_lat        numeric(9,6),
        ADD COLUMN IF NOT EXISTS checkin_lng        numeric(9,6)
    `);
    console.log("✓ bookings: added recurring, cancellation, GPS check-in");

    // ── Notifications table ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type        text NOT NULL,
        title       text NOT NULL,
        body        text NOT NULL,
        data        jsonb DEFAULT '{}',
        is_read     boolean NOT NULL DEFAULT false,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id 
      ON notifications(user_id, is_read, created_at DESC)
    `);
    console.log("✓ notifications: table created");

    // ── Maid documents (ID verification) ─────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS maid_documents (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        maid_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        doc_type     text NOT NULL,  -- 'national_id', 'passport', 'utility_bill'
        doc_url      text NOT NULL,
        status       text NOT NULL DEFAULT 'pending', -- 'pending','approved','rejected'
        admin_notes  text,
        submitted_at timestamptz NOT NULL DEFAULT now(),
        reviewed_at  timestamptz
      )
    `);
    console.log("✓ maid_documents: table created");

    // ── Maid availability slots ───────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS maid_availability (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        maid_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day_of_week integer NOT NULL, -- 0=Sun, 1=Mon ... 6=Sat
        start_time  time NOT NULL,
        end_time    time NOT NULL,
        is_active   boolean NOT NULL DEFAULT true
      )
    `);
    console.log("✓ maid_availability: table created");

    // ── Indexes for performance ───────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id, status);
      CREATE INDEX IF NOT EXISTS idx_bookings_maid ON bookings(maid_id, status);
      CREATE INDEX IF NOT EXISTS idx_maid_profiles_location ON maid_profiles(latitude, longitude);
      CREATE INDEX IF NOT EXISTS idx_reviews_maid ON reviews(maid_id);
    `);
    console.log("✓ indexes created");

    await client.query("COMMIT");
    console.log("\n✅ All migrations complete");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("✗ Migration failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
run().catch(console.error);
