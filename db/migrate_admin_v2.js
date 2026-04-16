// db/migrate_admin_v2.js
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

    // ── Admin audit log ───────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_id    uuid NOT NULL REFERENCES users(id),
        action      text NOT NULL,
        entity_type text NOT NULL,  -- 'user','booking','payment','withdrawal','maid_document'
        entity_id   uuid,
        before_data jsonb,
        after_data  jsonb,
        ip_address  text,
        notes       text,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_admin    ON admin_audit_log(admin_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_entity   ON admin_audit_log(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created  ON admin_audit_log(created_at DESC);
    `);
    console.log("✓ admin_audit_log: table created");

    // ── Platform settings (key-value) ─────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        key         text PRIMARY KEY,
        value       jsonb NOT NULL,
        description text,
        updated_by  uuid REFERENCES users(id),
        updated_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Seed default settings
    await client.query(`
      INSERT INTO platform_settings (key, value, description) VALUES
        ('platform_fee_customer',  '10',                        'Customer service fee percent'),
        ('platform_fee_maid',      '0',                         'Maid commission percent'),
        ('withdrawal_min_ngn',     '2000',                      'Minimum withdrawal in NGN'),
        ('withdrawal_fee_tier1',   '200',                       'Withdrawal fee under 10k NGN'),
        ('withdrawal_fee_tier2',   '350',                       'Withdrawal fee 10k-50k NGN'),
        ('withdrawal_fee_tier3',   '500',                       'Withdrawal fee 50k-200k NGN'),
        ('withdrawal_fee_tier4',   '750',                       'Withdrawal fee above 200k NGN'),
        ('booking_auto_cancel_hrs','24',                        'Hours before auto-cancelling unpaid bookings'),
        ('max_booking_duration',   '24',                        'Maximum booking duration in hours'),
        ('platform_maintenance',   'false',                     'Put platform in maintenance mode'),
        ('new_registrations',      'true',                      'Allow new user registrations'),
        ('support_email',          '"support@deusizisparkle.com"', 'Support email address'),
        ('support_phone',          '"+2348000000000"',          'Support phone number'),
        ('supported_countries',    '["NG","GH","KE","ZA","GB","US","CA","AU"]', 'Supported countries')
      ON CONFLICT (key) DO NOTHING
    `);
    console.log("✓ platform_settings: table created and seeded");

    // ── Admin notes on users ──────────────────────────────────────
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS admin_notes    text,
        ADD COLUMN IF NOT EXISTS flagged        boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS flag_reason    text,
        ADD COLUMN IF NOT EXISTS banned_at      timestamptz,
        ADD COLUMN IF NOT EXISTS ban_reason     text
    `);
    console.log("✓ users: admin fields added");

    // ── Reports table (generated reports) ────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_reports (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type        text NOT NULL,  -- 'revenue','bookings','users','maids','withdrawals'
        period      text NOT NULL,  -- 'daily','weekly','monthly','custom'
        date_from   date NOT NULL,
        date_to     date NOT NULL,
        data        jsonb NOT NULL DEFAULT '{}',
        generated_by uuid REFERENCES users(id),
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    console.log("✓ admin_reports: table created");

    await client.query("COMMIT");
    console.log("\n✅ Admin v2 migration complete");
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
