// scripts/migrate-and-seed.js
// Run with: node scripts/migrate-and-seed.js
// Or:       node --env-file=.env scripts/migrate-and-seed.js

import pg from "pg";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname } from "path";

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();

  try {
    console.log("🔌 Connected to database");
    await client.query("BEGIN");

    // ══════════════════════════════════════════════════════════════
    // 1. MIGRATIONS — add missing columns safely
    // ══════════════════════════════════════════════════════════════
    console.log("\n📦 Running migrations…");

    const migrations = [
      // emergency_contacts — add email + phone_country_code
      `ALTER TABLE emergency_contacts
         ADD COLUMN IF NOT EXISTS email TEXT,
         ADD COLUMN IF NOT EXISTS phone_country_code TEXT DEFAULT '+234'`,

      // bookings — add checkin/checkout tracking columns
      `ALTER TABLE bookings
         ADD COLUMN IF NOT EXISTS checkin_at        TIMESTAMPTZ,
         ADD COLUMN IF NOT EXISTS checkout_at       TIMESTAMPTZ,
         ADD COLUMN IF NOT EXISTS checkin_lat       NUMERIC(10,7),
         ADD COLUMN IF NOT EXISTS checkin_lng       NUMERIC(10,7),
         ADD COLUMN IF NOT EXISTS live_tracking_on  BOOLEAN DEFAULT false,
         ADD COLUMN IF NOT EXISTS video_call_room   TEXT,
         ADD COLUMN IF NOT EXISTS video_call_token  TEXT,
         ADD COLUMN IF NOT EXISTS video_call_status TEXT DEFAULT 'idle',
         ADD COLUMN IF NOT EXISTS maid_accepted_at  TIMESTAMPTZ,
         ADD COLUMN IF NOT EXISTS cancelled_by      TEXT,
         ADD COLUMN IF NOT EXISTS cancelled_reason  TEXT,
         ADD COLUMN IF NOT EXISTS cancelled_at      TIMESTAMPTZ`,

      // maid_profiles — add rate columns + extras
      `ALTER TABLE maid_profiles
         ADD COLUMN IF NOT EXISTS rate_hourly     NUMERIC(12,2),
         ADD COLUMN IF NOT EXISTS rate_daily      NUMERIC(12,2),
         ADD COLUMN IF NOT EXISTS rate_weekly     NUMERIC(12,2),
         ADD COLUMN IF NOT EXISTS rate_monthly    NUMERIC(12,2),
         ADD COLUMN IF NOT EXISTS rate_custom     JSONB DEFAULT '{}',
         ADD COLUMN IF NOT EXISTS pricing_note    TEXT,
         ADD COLUMN IF NOT EXISTS currency        TEXT DEFAULT 'NGN',
         ADD COLUMN IF NOT EXISTS latitude        NUMERIC(10,7),
         ADD COLUMN IF NOT EXISTS longitude       NUMERIC(10,7),
         ADD COLUMN IF NOT EXISTS languages       TEXT[],
         ADD COLUMN IF NOT EXISTS max_distance_km INTEGER DEFAULT 50,
         ADD COLUMN IF NOT EXISTS id_verified     BOOLEAN DEFAULT false,
         ADD COLUMN IF NOT EXISTS background_checked BOOLEAN DEFAULT false`,

      // payments — add all gateway columns
      `ALTER TABLE payments
         ADD COLUMN IF NOT EXISTS paystack_access_code  TEXT,
         ADD COLUMN IF NOT EXISTS stripe_session_id     TEXT,
         ADD COLUMN IF NOT EXISTS stripe_payment_id     TEXT,
         ADD COLUMN IF NOT EXISTS bank_transfer_ref     TEXT,
         ADD COLUMN IF NOT EXISTS bank_transfer_status  TEXT DEFAULT 'awaiting_proof',
         ADD COLUMN IF NOT EXISTS bank_transfer_proof   TEXT,
         ADD COLUMN IF NOT EXISTS platform_fee          NUMERIC(12,2) DEFAULT 0,
         ADD COLUMN IF NOT EXISTS maid_payout           NUMERIC(12,2) DEFAULT 0,
         ADD COLUMN IF NOT EXISTS payout_status         TEXT DEFAULT 'pending',
         ADD COLUMN IF NOT EXISTS payout_at             TIMESTAMPTZ,
         ADD COLUMN IF NOT EXISTS paid_at               TIMESTAMPTZ,
         ADD COLUMN IF NOT EXISTS notes                 TEXT`,

      // booking_locations table
      `CREATE TABLE IF NOT EXISTS booking_locations (
         id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         booking_id   UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
         maid_id      UUID NOT NULL REFERENCES users(id),
         lat          NUMERIC(10,7) NOT NULL,
         lng          NUMERIC(10,7) NOT NULL,
         accuracy     NUMERIC(8,2),
         recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX IF NOT EXISTS idx_booking_locations_booking_id
         ON booking_locations(booking_id)`,
      `CREATE INDEX IF NOT EXISTS idx_booking_locations_recorded_at
         ON booking_locations(recorded_at DESC)`,

      // sos_alerts table
      `CREATE TABLE IF NOT EXISTS sos_alerts (
         id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         booking_id    UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
         triggered_by  UUID NOT NULL REFERENCES users(id),
         lat           NUMERIC(10,7),
         lng           NUMERIC(10,7),
         address       TEXT,
         message       TEXT,
         status        TEXT NOT NULL DEFAULT 'active',
         resolved_by   UUID REFERENCES users(id),
         resolved_at   TIMESTAMPTZ,
         created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX IF NOT EXISTS idx_sos_alerts_booking_id
         ON sos_alerts(booking_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sos_alerts_status
         ON sos_alerts(status)`,

      // maid_availability table
      `CREATE TABLE IF NOT EXISTS maid_availability (
         id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         maid_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         day_of_week  INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
         start_time   TIME NOT NULL,
         end_time     TIME NOT NULL,
         is_active    BOOLEAN DEFAULT true,
         created_at   TIMESTAMPTZ DEFAULT now(),
         UNIQUE(maid_id, day_of_week)
       )`,

      // maid_documents table
      `CREATE TABLE IF NOT EXISTS maid_documents (
         id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         maid_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         doc_type      TEXT NOT NULL,
         doc_url       TEXT NOT NULL,
         status        TEXT NOT NULL DEFAULT 'pending',
         admin_notes   TEXT,
         submitted_at  TIMESTAMPTZ DEFAULT now(),
         reviewed_at   TIMESTAMPTZ,
         UNIQUE(maid_id, doc_type)
       )`,

      // maid_payouts table
      `CREATE TABLE IF NOT EXISTS maid_payouts (
         id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         maid_id       UUID NOT NULL REFERENCES users(id),
         booking_id    UUID NOT NULL REFERENCES bookings(id),
         payment_id    UUID REFERENCES payments(id),
         amount        NUMERIC(12,2) NOT NULL,
         currency      TEXT NOT NULL DEFAULT 'NGN',
         status        TEXT NOT NULL DEFAULT 'escrow',
         payout_ref    TEXT,
         notes         TEXT,
         processed_by  UUID REFERENCES users(id),
         processed_at  TIMESTAMPTZ,
         created_at    TIMESTAMPTZ DEFAULT now()
       )`,

      // maid_bank_details table
      `CREATE TABLE IF NOT EXISTS maid_bank_details (
         id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         maid_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         bank_name       TEXT NOT NULL,
         account_number  TEXT NOT NULL,
         account_name    TEXT NOT NULL,
         bank_code       TEXT,
         country         TEXT DEFAULT 'NG',
         currency        TEXT DEFAULT 'NGN',
         verified        BOOLEAN DEFAULT false,
         created_at      TIMESTAMPTZ DEFAULT now(),
         updated_at      TIMESTAMPTZ DEFAULT now(),
         UNIQUE(maid_id)
       )`,

      // reviews — unique constraint on booking_id
      `CREATE UNIQUE INDEX IF NOT EXISTS reviews_booking_id_unique
         ON reviews(booking_id)`,

      // payments — unique constraint on paystack_reference
      `CREATE UNIQUE INDEX IF NOT EXISTS payments_paystack_ref_unique
         ON payments(paystack_reference) WHERE paystack_reference IS NOT NULL`,
    ];

    for (const sql of migrations) {
      const preview = sql.trim().split("\n")[0].slice(0, 70);
      try {
        await client.query(sql);
        console.log(`  ✅ ${preview}`);
      } catch (err) {
        // If already exists or other non-fatal errors, log and continue
        if (
          err.code === "42701" ||
          err.code === "42P07" ||
          err.code === "42P16"
        ) {
          console.log(`  ⚠️  Already exists (skipped): ${preview}`);
        } else {
          console.error(`  ❌ Failed: ${preview}`);
          console.error(`     ${err.message}`);
          throw err; // re-throw fatal errors
        }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // 2. BACKFILLS — sync rate_hourly from hourly_rate if null
    // ══════════════════════════════════════════════════════════════
    console.log("\n🔄 Running backfills…");

    await client.query(`
      UPDATE maid_profiles
      SET rate_hourly = hourly_rate
      WHERE rate_hourly IS NULL AND hourly_rate IS NOT NULL
    `);
    console.log("  ✅ Backfilled rate_hourly from hourly_rate");

    // ══════════════════════════════════════════════════════════════
    // 3. SEED DATA — only inserts if tables are empty
    // ══════════════════════════════════════════════════════════════
    console.log("\n🌱 Checking seed data…");

    // Check if any admin exists
    const { rows: admins } = await client.query(
      `SELECT id FROM users WHERE role = 'admin' LIMIT 1`,
    );

    if (!admins.length) {
      console.log("  ℹ️  No admin found — creating default admin…");
      // You'll want to change this password before production
      await client.query(`
        INSERT INTO users (name, email, password_hash, role, is_active)
        VALUES (
          'Deusizi Admin',
          'admin@deusizi.com',
          -- bcrypt of 'Admin@1234' — change this immediately
          '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
          'admin',
          true
        )
        ON CONFLICT (email) DO NOTHING
      `);
      console.log("  ✅ Default admin created: admin@deusizi.com / Admin@1234");
      console.log("  ⚠️  CHANGE THIS PASSWORD BEFORE PRODUCTION");
    } else {
      console.log("  ✅ Admin exists — skipping admin seed");
    }

    await client.query("COMMIT");
    console.log("\n✅ All migrations and seeds completed successfully!\n");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n❌ Migration failed — rolled back");
    console.error(err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
