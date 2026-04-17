// scripts/migrate-custom-rates.js
import pool from "../src/config/database.js";

const sql = `
  -- Add rate_custom if it doesn't exist
  ALTER TABLE maid_profiles
    ADD COLUMN IF NOT EXISTS rate_custom  JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS rate_hourly  NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS rate_daily   NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS rate_weekly  NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS rate_monthly NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS pricing_note TEXT,
    ADD COLUMN IF NOT EXISTS currency     VARCHAR(10) DEFAULT 'NGN';

  -- Initialise rate_custom to {} where NULL
  UPDATE maid_profiles SET rate_custom = '{}' WHERE rate_custom IS NULL;
`;

try {
  await pool.query(sql);
  console.log("✅ Custom rates migration complete");
  process.exit(0);
} catch (err) {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
}
