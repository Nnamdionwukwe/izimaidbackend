-- db/seed/admin.sql
-- Matches: src/controllers/admin.controller.js
-- Creates: admin_audit_log, platform_settings
-- Defensive stubs: customer_support_tickets, maid_support_tickets
--                  (full schema comes from their own controllers)
-- Verified against live DB; drift-repaired.

-- ══════════════════════════════════════════════════════════════════════
--  admin_audit_log — immutable record of every admin action
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,

  action          TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       UUID,

  before_data     JSONB,
  after_data      JSONB,

  notes           TEXT,               -- free-form annotations
  ip_address      TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drift-repair
ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_admin_audit_admin   ON admin_audit_log (admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action  ON admin_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_entity  ON admin_audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log (created_at DESC);

-- ══════════════════════════════════════════════════════════════════════
--  platform_settings — global config store (feature flags, thresholds, etc.)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS platform_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drift-repair
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_platform_settings_key ON platform_settings (key);

DROP TRIGGER IF EXISTS trg_platform_settings_updated_at ON platform_settings;
CREATE TRIGGER trg_platform_settings_updated_at
  BEFORE UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  customer_support_tickets — DEFENSIVE STUB
--  Full schema comes from customer-support-tickets.controller.js
--  NOTE: live uses `user_id`; our full seed will extend this later.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS customer_support_tickets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject           TEXT,
  category          TEXT,
  message           TEXT,
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','in_progress','waiting','resolved','closed')),
  priority          TEXT NOT NULL DEFAULT 'normal'
                      CHECK (priority IN ('low','normal','high','urgent')),
  attachment_count  INTEGER NOT NULL DEFAULT 0,
  admin_notes       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drift-repair
ALTER TABLE customer_support_tickets ADD COLUMN IF NOT EXISTS category         TEXT;
ALTER TABLE customer_support_tickets ADD COLUMN IF NOT EXISTS message          TEXT;
ALTER TABLE customer_support_tickets ADD COLUMN IF NOT EXISTS attachment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customer_support_tickets ADD COLUMN IF NOT EXISTS admin_notes      TEXT;

CREATE INDEX IF NOT EXISTS idx_customer_support_tickets_status ON customer_support_tickets (status);
CREATE INDEX IF NOT EXISTS idx_customer_support_tickets_user   ON customer_support_tickets (user_id);
CREATE INDEX IF NOT EXISTS idx_customer_support_tickets_cat    ON customer_support_tickets (category);

DROP TRIGGER IF EXISTS trg_customer_support_tickets_updated_at ON customer_support_tickets;
CREATE TRIGGER trg_customer_support_tickets_updated_at
  BEFORE UPDATE ON customer_support_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  maid_support_tickets — DEFENSIVE STUB
--  NOTE: live uses `user_id` (NOT `maid_id`). We align to live.
--  Full schema comes from maid-support-tickets.controller.js
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS maid_support_tickets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject           TEXT,
  category          TEXT,
  message           TEXT,
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','in_progress','waiting','resolved','closed')),
  priority          TEXT NOT NULL DEFAULT 'normal'
                      CHECK (priority IN ('low','normal','high','urgent')),
  attachment_count  INTEGER NOT NULL DEFAULT 0,
  admin_notes       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drift-repair: if an older version of this table exists with `maid_id`,
-- add `user_id` and backfill.
ALTER TABLE maid_support_tickets ADD COLUMN IF NOT EXISTS user_id          UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE maid_support_tickets ADD COLUMN IF NOT EXISTS category         TEXT;
ALTER TABLE maid_support_tickets ADD COLUMN IF NOT EXISTS message          TEXT;
ALTER TABLE maid_support_tickets ADD COLUMN IF NOT EXISTS attachment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE maid_support_tickets ADD COLUMN IF NOT EXISTS admin_notes      TEXT;

-- Backfill user_id from maid_id if the old column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='maid_support_tickets' AND column_name='maid_id'
  ) THEN
    EXECUTE 'UPDATE maid_support_tickets SET user_id = maid_id WHERE user_id IS NULL AND maid_id IS NOT NULL';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_maid_support_tickets_status ON maid_support_tickets (status);
CREATE INDEX IF NOT EXISTS idx_maid_support_tickets_user   ON maid_support_tickets (user_id);
CREATE INDEX IF NOT EXISTS idx_maid_support_tickets_cat    ON maid_support_tickets (category);

DROP TRIGGER IF EXISTS trg_maid_support_tickets_updated_at ON maid_support_tickets;
CREATE TRIGGER trg_maid_support_tickets_updated_at
  BEFORE UPDATE ON maid_support_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  Platform settings — initial defaults
--  ON CONFLICT DO NOTHING so existing live values are preserved.
-- ══════════════════════════════════════════════════════════════════════
INSERT INTO platform_settings (key, value, description) VALUES
  ('platform_fee_percent',     '15'::jsonb,      'Platform commission percentage on bookings'),
  ('min_withdrawal_ngn',       '2000'::jsonb,    'Minimum withdrawal amount in NGN equivalent'),
  ('max_booking_hours',        '12'::jsonb,      'Maximum hours per booking'),
  ('sos_auto_escalate_min',    '5'::jsonb,       'Minutes before unresolved SOS escalates to all admins'),
  ('maintenance_mode',         'false'::jsonb,   'Disable non-admin API access when true'),
  ('allow_new_registrations',  'true'::jsonb,    'Allow new user signups')
ON CONFLICT (key) DO NOTHING;