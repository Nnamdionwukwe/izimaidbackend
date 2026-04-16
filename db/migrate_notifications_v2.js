// db/migrate_notifications_v2.js
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

    // Drop and recreate with full schema if exists without all columns
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type        text NOT NULL,
        title       text NOT NULL,
        body        text NOT NULL,
        data        jsonb   NOT NULL DEFAULT '{}',
        is_read     boolean NOT NULL DEFAULT false,
        read_at     timestamptz,
        channel     text    NOT NULL DEFAULT 'in_app', -- 'in_app','email','push','sms'
        priority    text    NOT NULL DEFAULT 'normal',  -- 'low','normal','high','urgent'
        action_url  text,    -- deep link e.g. /bookings/uuid
        image_url   text,    -- avatar or icon URL
        expires_at  timestamptz,  -- auto-hide after this time
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Indexes for fast queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notif_user_unread
        ON notifications(user_id, is_read, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notif_user_type
        ON notifications(user_id, type, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notif_created
        ON notifications(created_at DESC);
    `);

    // Push tokens — for future mobile push notifications
    await client.query(`
      CREATE TABLE IF NOT EXISTS push_tokens (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token       text NOT NULL,
        platform    text NOT NULL DEFAULT 'web', -- 'web','ios','android'
        device_id   text,
        is_active   boolean NOT NULL DEFAULT true,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE(user_id, token)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_push_tokens_user
        ON push_tokens(user_id, is_active)
    `);

    // Notification preferences — user controls what they receive
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id                   uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

        -- In-app toggles
        inapp_bookings            boolean NOT NULL DEFAULT true,
        inapp_payments            boolean NOT NULL DEFAULT true,
        inapp_messages            boolean NOT NULL DEFAULT true,
        inapp_reviews             boolean NOT NULL DEFAULT true,
        inapp_withdrawals         boolean NOT NULL DEFAULT true,
        inapp_support             boolean NOT NULL DEFAULT true,
        inapp_system              boolean NOT NULL DEFAULT true,
        inapp_promotions          boolean NOT NULL DEFAULT true,

        -- Email toggles
        email_bookings            boolean NOT NULL DEFAULT true,
        email_payments            boolean NOT NULL DEFAULT true,
        email_messages            boolean NOT NULL DEFAULT false,
        email_reviews             boolean NOT NULL DEFAULT true,
        email_withdrawals         boolean NOT NULL DEFAULT true,
        email_support             boolean NOT NULL DEFAULT true,
        email_system              boolean NOT NULL DEFAULT true,
        email_promotions          boolean NOT NULL DEFAULT false,

        -- Push toggles (future mobile)
        push_bookings             boolean NOT NULL DEFAULT true,
        push_payments             boolean NOT NULL DEFAULT true,
        push_messages             boolean NOT NULL DEFAULT true,
        push_reviews              boolean NOT NULL DEFAULT true,
        push_withdrawals          boolean NOT NULL DEFAULT true,
        push_support              boolean NOT NULL DEFAULT true,
        push_system               boolean NOT NULL DEFAULT true,
        push_promotions           boolean NOT NULL DEFAULT false,

        -- SMS toggles (future)
        sms_bookings              boolean NOT NULL DEFAULT false,
        sms_payments              boolean NOT NULL DEFAULT false,
        sms_security              boolean NOT NULL DEFAULT true,

        -- Quiet hours (don't push between these times)
        quiet_hours_enabled       boolean NOT NULL DEFAULT false,
        quiet_hours_start         time    DEFAULT '22:00',
        quiet_hours_end           time    DEFAULT '08:00',
        quiet_hours_timezone      text    DEFAULT 'Africa/Lagos',

        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    await client.query("COMMIT");
    console.log("✅ Notifications v2 migration complete");
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
