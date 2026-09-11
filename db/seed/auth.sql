-- db/seed/auth.sql
-- Matches: src/controllers/auth.js
-- Tables owned: users, user_devices, user_settings, maid_profiles (minimal),
--               subscriptions (for deleteAccount)

-- ══════════════════════════════════════════════════════════════════════
--  users — the base table for the whole app
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                    TEXT NOT NULL UNIQUE,
  name                     TEXT NOT NULL,
  avatar                   TEXT,
  role                     TEXT NOT NULL DEFAULT 'customer'
                             CHECK (role IN ('customer','maid','admin')),
  phone                    TEXT,
  country                  TEXT DEFAULT 'NG',
  language                 TEXT DEFAULT 'en',

  -- Auth
  password_hash            TEXT,
  auth_provider            TEXT NOT NULL DEFAULT 'email'
                             CHECK (auth_provider IN ('email','google')),
  google_id                TEXT UNIQUE,

  -- Email verification
  email_verified           BOOLEAN NOT NULL DEFAULT false,
  email_verify_token       TEXT,
  email_verify_expires     TIMESTAMPTZ,

  -- Password reset
  reset_token              TEXT,
  reset_token_expires      TIMESTAMPTZ,

  -- Account status
  is_active                BOOLEAN NOT NULL DEFAULT true,

  -- Subscription fields (used by auth.getMe + googleLogin)
  subscription_plan        TEXT,
  subscription_badge       TEXT,

  -- Admin fields (used by admin.js, referenced here for completeness)
  flagged                  BOOLEAN NOT NULL DEFAULT false,
  flag_reason              TEXT,
  ban_reason               TEXT,
  banned_at                TIMESTAMPTZ,
  admin_notes              TEXT,

  -- Timestamps
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at             TIMESTAMPTZ
);

-- Indexes for auth queries
CREATE INDEX IF NOT EXISTS idx_users_email           ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_google_id       ON users (google_id) WHERE google_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_reset_token     ON users (reset_token) WHERE reset_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_verify_token    ON users (email_verify_token) WHERE email_verify_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role            ON users (role);

-- ══════════════════════════════════════════════════════════════════════
--  user_devices — device fingerprint tracking (handleDeviceTracking)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_hash   TEXT NOT NULL,
  user_agent    TEXT,
  ip_address    TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_hash)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user ON user_devices (user_id);

-- ══════════════════════════════════════════════════════════════════════
--  user_settings — preferences (created on register + googleLogin)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_settings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  language             TEXT NOT NULL DEFAULT 'en',
  currency             TEXT NOT NULL DEFAULT 'NGN',
  theme                TEXT DEFAULT 'light',
  notifications_email  BOOLEAN NOT NULL DEFAULT true,
  notifications_push   BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings (user_id);

-- ══════════════════════════════════════════════════════════════════════
--  maid_profiles — minimal columns for auth (created when role=maid)
--  Full definition will come from maids.sql
-- ══════════════════════════════════════════════════════════════════════
-- NOTE: auth.js inserts: (user_id, hourly_rate, is_available)
--       and reads: mp.id_verified, mp.background_checked
-- Full profile schema is created in maids.sql — but we create the minimal
-- version here so auth.js works standalone.
CREATE TABLE IF NOT EXISTS maid_profiles (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  hourly_rate            NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_available           BOOLEAN NOT NULL DEFAULT false,
  id_verified            BOOLEAN NOT NULL DEFAULT false,
  background_checked     BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maid_profiles_user ON maid_profiles (user_id);

-- ══════════════════════════════════════════════════════════════════════
--  subscriptions — needed by deleteAccount
--  Full definition will come from subscriptions.controller.js
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS subscriptions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id              TEXT,
  status               TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','trialing','paused','cancelled','expired')),
  current_period_end   TIMESTAMPTZ,
  cancelled_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user   ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status);

-- ══════════════════════════════════════════════════════════════════════
--  updated_at trigger — auto-update on row change
-- ══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to users
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Apply trigger to user_settings
DROP TRIGGER IF EXISTS trg_user_settings_updated_at ON user_settings;
CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Apply trigger to maid_profiles
DROP TRIGGER IF EXISTS trg_maid_profiles_updated_at ON maid_profiles;
CREATE TRIGGER trg_maid_profiles_updated_at
  BEFORE UPDATE ON maid_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Apply trigger to subscriptions
DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();