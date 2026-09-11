-- db/seed/notifications.controller.sql
-- Matches: src/controllers/notifications.controller.js
-- Extends: push_tokens (device_id)
-- No new tables — notifications + notification_preferences are already complete.

-- ══════════════════════════════════════════════════════════════════════
--  push_tokens — add device_id for multi-device registration
--  Used by registerPushToken to distinguish installs per user.
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS device_id TEXT;

CREATE INDEX IF NOT EXISTS idx_push_tokens_device
  ON push_tokens (user_id, device_id)
  WHERE device_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════
--  No seed data — per-user transactional table
-- ══════════════════════════════════════════════════════════════════════
