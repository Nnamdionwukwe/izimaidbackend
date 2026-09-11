-- db/seed/housekeeperTraining.controller.sql
-- Matches: src/controllers/housekeeperTraining.controller.js
--          src/models/HousekeeperApplication.js
-- Creates: housekeeper_applications

-- ══════════════════════════════════════════════════════════════════════
--  housekeeper_applications — housekeeper training program applications
--  Public form, no user account required.
--  Structurally parallel to cleaner_applications.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS housekeeper_applications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tracking reference, e.g. 'DHA-123456-789'
  reference_number      TEXT NOT NULL UNIQUE,

  -- Applicant info
  full_name             TEXT NOT NULL,
  email                 TEXT NOT NULL,
  phone                 TEXT NOT NULL,

  -- Location
  city                  TEXT NOT NULL
                          CHECK (city IN ('Abuja','Lagos')),

  -- Training track
  preferred_track       TEXT NOT NULL
                          CHECK (preferred_track IN (
                            'Household Management',
                            'Laundry & Linen Care',
                            'Home Organisation',
                            'Meal Prep & Kitchen Support',
                            'Luxury & Estate Housekeeping',
                            'Childcare-Safe Housekeeping',
                            'Not sure - recommend one for me'
                          )),

  -- Background
  experience_level      TEXT
                          CHECK (experience_level IS NULL OR experience_level IN (
                            'none','under1','1-2','3-5','5+'
                          )),

  motivation            TEXT NOT NULL,

  -- Multi-select availability windows
  availability          TEXT[] NOT NULL DEFAULT '{}'::text[],

  -- Lifecycle
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','reviewed','accepted','rejected','enrolled')),

  -- Admin review
  admin_notes           TEXT,
  reviewed_at           TIMESTAMPTZ,
  reviewed_by           UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Application date
  application_date      TIMESTAMPTZ NOT NULL DEFAULT now(),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_housekeeper_apps_reference     ON housekeeper_applications (reference_number);
CREATE INDEX IF NOT EXISTS idx_housekeeper_apps_status        ON housekeeper_applications (status);
CREATE INDEX IF NOT EXISTS idx_housekeeper_apps_city          ON housekeeper_applications (city);
CREATE INDEX IF NOT EXISTS idx_housekeeper_apps_track         ON housekeeper_applications (preferred_track);
CREATE INDEX IF NOT EXISTS idx_housekeeper_apps_email         ON housekeeper_applications (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_housekeeper_apps_availability  ON housekeeper_applications USING GIN (availability);
CREATE INDEX IF NOT EXISTS idx_housekeeper_apps_created       ON housekeeper_applications (created_at DESC);

DROP TRIGGER IF EXISTS trg_housekeeper_apps_updated_at ON housekeeper_applications;
CREATE TRIGGER trg_housekeeper_apps_updated_at
  BEFORE UPDATE ON housekeeper_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();