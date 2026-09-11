-- db/seed/settings.controller.sql
-- Matches: src/controllers/settings.controller.js
-- Extends: users (pin_set_at, deleted_at), user_settings (notifications_sms)
-- Creates: supported_currencies, supported_languages

-- ══════════════════════════════════════════════════════════════════════
--  users — extend with PIN lifecycle + soft-delete columns
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_set_at   TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at
  ON users (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════
--  user_settings — add SMS notifications toggle
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS notifications_sms BOOLEAN NOT NULL DEFAULT true;

-- ══════════════════════════════════════════════════════════════════════
--  supported_currencies — reference data
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS supported_currencies (
  code                TEXT PRIMARY KEY,       -- ISO 4217 code, e.g. 'NGN'
  name                TEXT NOT NULL,
  symbol              TEXT,
  decimal_places      INTEGER NOT NULL DEFAULT 2,
  paystack_supported  BOOLEAN NOT NULL DEFAULT false,
  stripe_supported    BOOLEAN NOT NULL DEFAULT false,
  flutterwave_supported BOOLEAN NOT NULL DEFAULT false,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supported_currencies_active ON supported_currencies (is_active) WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_supported_currencies_updated_at ON supported_currencies;
CREATE TRIGGER trg_supported_currencies_updated_at
  BEFORE UPDATE ON supported_currencies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  supported_languages — reference data
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS supported_languages (
  code          TEXT PRIMARY KEY,             -- BCP-47 code, e.g. 'en', 'yo', 'ha'
  name          TEXT NOT NULL,                -- English name
  native_name   TEXT,                         -- Native name
  rtl           BOOLEAN NOT NULL DEFAULT false,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supported_languages_active ON supported_languages (is_active) WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_supported_languages_updated_at ON supported_languages;
CREATE TRIGGER trg_supported_languages_updated_at
  BEFORE UPDATE ON supported_languages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();