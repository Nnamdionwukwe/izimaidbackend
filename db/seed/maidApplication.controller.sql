-- db/seed/maidApplication.controller.sql
-- Matches: src/controllers/maidApplication.controller.js
--          src/models/MaidApplication.js
-- Creates: maid_applications

-- ══════════════════════════════════════════════════════════════════════
--  maid_applications — maids applying to join the platform
--  Public form, no user account required.
--  Distinct from maid_profiles: applicants aren't users yet.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS maid_applications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tracking reference, e.g. 'MA-123456-789'
  reference_number   TEXT NOT NULL UNIQUE,

  -- Applicant info
  full_name          TEXT NOT NULL,
  email              TEXT NOT NULL,
  phone              TEXT NOT NULL,

  -- Location (fixed list)
  city               TEXT NOT NULL
                       CHECK (city IN ('Abuja','Lagos')),

  -- Experience: '0', '1', '2', '3', '5+'
  experience_level   TEXT,

  -- Services the applicant offers (array of strings)
  services           TEXT[] NOT NULL DEFAULT '{}'::text[],

  message            TEXT NOT NULL,

  -- Lifecycle
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','reviewed','approved','rejected','onboarded')),

  -- Admin review
  admin_notes        TEXT,
  reviewed_at        TIMESTAMPTZ,
  reviewed_by        UUID REFERENCES users(id) ON DELETE SET NULL,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maid_apps_reference  ON maid_applications (reference_number);
CREATE INDEX IF NOT EXISTS idx_maid_apps_status     ON maid_applications (status);
CREATE INDEX IF NOT EXISTS idx_maid_apps_city       ON maid_applications (city);
CREATE INDEX IF NOT EXISTS idx_maid_apps_email      ON maid_applications (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_maid_apps_services   ON maid_applications USING GIN (services);
CREATE INDEX IF NOT EXISTS idx_maid_apps_created    ON maid_applications (created_at DESC);

DROP TRIGGER IF EXISTS trg_maid_apps_updated_at ON maid_applications;
CREATE TRIGGER trg_maid_apps_updated_at
  BEFORE UPDATE ON maid_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();