// db/migrate_pricing_settings.js
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

    // ── Maid pricing: multiple rate types ───────────────────────
    await client.query(`
      ALTER TABLE maid_profiles
        ADD COLUMN IF NOT EXISTS rate_hourly   numeric DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS rate_daily    numeric DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS rate_weekly   numeric DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS rate_monthly  numeric DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS rate_custom   jsonb   DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS pricing_note  text    DEFAULT NULL
    `);
    console.log("✓ maid_profiles: added multi-rate pricing");

    // ── User settings table ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        language        text NOT NULL DEFAULT 'en',
        currency        text NOT NULL DEFAULT 'NGN',
        theme           text NOT NULL DEFAULT 'system', -- 'light','dark','system'
        notifications_email   boolean NOT NULL DEFAULT true,
        notifications_push    boolean NOT NULL DEFAULT true,
        notifications_sms     boolean NOT NULL DEFAULT false,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      )
    `);
    console.log("✓ user_settings: table created");

    // ── Supported currencies table ───────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS supported_currencies (
        code        text PRIMARY KEY,  -- 'NGN', 'USD', 'GBP', 'EUR', 'KES', etc.
        name        text NOT NULL,
        symbol      text NOT NULL,
        is_active   boolean NOT NULL DEFAULT true,
        paystack_supported  boolean NOT NULL DEFAULT false,
        stripe_supported    boolean NOT NULL DEFAULT false
      )
    `);

    // Seed currencies
    await client.query(`
      INSERT INTO supported_currencies (code, name, symbol, paystack_supported, stripe_supported) VALUES
        ('NGN', 'Nigerian Naira',     '₦', true,  false),
        ('USD', 'US Dollar',          '$', false, true),
        ('GBP', 'British Pound',      '£', false, true),
        ('EUR', 'Euro',               '€', false, true),
        ('KES', 'Kenyan Shilling',    'KSh', true, false),
        ('GHS', 'Ghanaian Cedi',      '₵', true, false),
        ('ZAR', 'South African Rand', 'R', false, true),
        ('CAD', 'Canadian Dollar',    'CA$', false, true),
        ('AUD', 'Australian Dollar',  'A$', false, true)
      ON CONFLICT (code) DO NOTHING
    `);
    console.log("✓ supported_currencies: seeded");

    // ── Supported languages table ────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS supported_languages (
        code        text PRIMARY KEY,  -- 'en', 'fr', 'ar', 'yo', etc.
        name        text NOT NULL,     -- 'English', 'French'
        native_name text NOT NULL,     -- 'English', 'Français', 'العربية'
        rtl         boolean NOT NULL DEFAULT false,
        is_active   boolean NOT NULL DEFAULT true
      )
    `);

    await client.query(`
      INSERT INTO supported_languages (code, name, native_name, rtl) VALUES
        ('en', 'English',    'English',     false),
        ('fr', 'French',     'Français',    false),
        ('ar', 'Arabic',     'العربية',     true),
        ('yo', 'Yoruba',     'Yorùbá',      false),
        ('ha', 'Hausa',      'Hausa',       false),
        ('ig', 'Igbo',       'Igbo',        false),
        ('sw', 'Swahili',    'Kiswahili',   false),
        ('pt', 'Portuguese', 'Português',   false),
        ('es', 'Spanish',    'Español',     false),
        ('de', 'German',     'Deutsch',     false),
        ('zh', 'Chinese',    '中文',         false),
        ('hi', 'Hindi',      'हिन्दी',       false),
        ('id', 'Indonesian', 'Bahasa Indonesia', false),
        ('tr', 'Turkish',    'Türkçe',      false),
        ('ru', 'Russian',    'Русский',     false)
      ON CONFLICT (code) DO NOTHING
    `);
    console.log("✓ supported_languages: seeded");

    await client.query("COMMIT");
    console.log("\n✅ Pricing + settings migrations complete");
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
