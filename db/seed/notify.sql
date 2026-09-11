-- db/seed/notify.sql
-- Matches: src/utils/notify.js
-- Creates: notification_preferences, notifications
-- Verified against live DB column-by-column.

-- ══════════════════════════════════════════════════════════════════════
--  notification_preferences — per-user, per-channel, per-category toggles
--  Channels: inapp, email, push, sms  (SMS unused by notify.js today but
--            present in live DB — kept for parity)
--  Categories: bookings, payments, messages, reviews, withdrawals,
--              support, system, promotions, security
--  All default TRUE (opt-out model)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notification_preferences (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- ── In-app ──────────────────────────────────────────────────────
  inapp_bookings         BOOLEAN NOT NULL DEFAULT true,
  inapp_payments         BOOLEAN NOT NULL DEFAULT true,
  inapp_messages         BOOLEAN NOT NULL DEFAULT true,
  inapp_reviews          BOOLEAN NOT NULL DEFAULT true,
  inapp_withdrawals      BOOLEAN NOT NULL DEFAULT true,
  inapp_support          BOOLEAN NOT NULL DEFAULT true,
  inapp_system           BOOLEAN NOT NULL DEFAULT true,
  inapp_promotions       BOOLEAN NOT NULL DEFAULT true,

  -- ── Email ───────────────────────────────────────────────────────
  email_bookings         BOOLEAN NOT NULL DEFAULT true,
  email_payments         BOOLEAN NOT NULL DEFAULT true,
  email_messages         BOOLEAN NOT NULL DEFAULT true,
  email_reviews          BOOLEAN NOT NULL DEFAULT true,
  email_withdrawals      BOOLEAN NOT NULL DEFAULT true,
  email_support          BOOLEAN NOT NULL DEFAULT true,
  email_system           BOOLEAN NOT NULL DEFAULT true,
  email_promotions       BOOLEAN NOT NULL DEFAULT true,

  -- ── Push ────────────────────────────────────────────────────────
  push_bookings          BOOLEAN NOT NULL DEFAULT true,
  push_payments          BOOLEAN NOT NULL DEFAULT true,
  push_messages          BOOLEAN NOT NULL DEFAULT true,
  push_reviews           BOOLEAN NOT NULL DEFAULT true,
  push_withdrawals       BOOLEAN NOT NULL DEFAULT true,
  push_support           BOOLEAN NOT NULL DEFAULT true,
  push_system            BOOLEAN NOT NULL DEFAULT true,
  push_promotions        BOOLEAN NOT NULL DEFAULT true,

  -- ── SMS (present in live; notify.js does not currently use these) ──
  sms_bookings           BOOLEAN NOT NULL DEFAULT true,
  sms_payments           BOOLEAN NOT NULL DEFAULT true,
  sms_security           BOOLEAN NOT NULL DEFAULT true,

  -- ── Quiet hours ─────────────────────────────────────────────────
  quiet_hours_enabled    BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_start      TIME,
  quiet_hours_end        TIME,
  quiet_hours_timezone   TEXT NOT NULL DEFAULT 'Africa/Lagos',

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drift-repair: add columns to older DBs
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS sms_bookings         BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS sms_payments         BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS sms_security         BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS quiet_hours_enabled  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS quiet_hours_timezone TEXT NOT NULL DEFAULT 'Africa/Lagos';

CREATE INDEX IF NOT EXISTS idx_notif_prefs_user ON notification_preferences (user_id);

DROP TRIGGER IF EXISTS trg_notif_prefs_updated_at ON notification_preferences;
CREATE TRIGGER trg_notif_prefs_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  notifications — in-app notification inbox
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority     TEXT NOT NULL DEFAULT 'normal'
                 CHECK (priority IN ('low','normal','high','urgent')),
  action_url   TEXT,
  image_url    TEXT,
  expires_at   TIMESTAMPTZ,

  channel      TEXT NOT NULL DEFAULT 'in_app'
                 CHECK (channel IN ('in_app','email','push')),

  is_read      BOOLEAN NOT NULL DEFAULT false,
  read_at      TIMESTAMPTZ,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drift-repair for `notifications`
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at    TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS channel    TEXT NOT NULL DEFAULT 'in_app';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS image_url  TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notifications_user         ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread  ON notifications (user_id, created_at DESC)
  WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_type         ON notifications (type);
CREATE INDEX IF NOT EXISTS idx_notifications_created      ON notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_expires      ON notifications (expires_at)
  WHERE expires_at IS NOT NULL;