-- db/seed/cleanerTraining.controller.sql
-- Matches: src/controllers/cleanerTraining.controller.js
--          src/models/CleanerApplication.js
-- Creates: cleaner_applications

-- ══════════════════════════════════════════════════════════════════════
--  cleaner_applications — cleaner training program applications
--  Public form, no user account required.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cleaner_applications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tracking reference, e.g. 'DSA-123456-789'
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
                            'Home Cleaning Professional',
                            'Commercial & Office Cleaning',
                            'Deep Cleaning Specialist',
                            'Post-Construction Cleaning',
                            'Kitchen & Hospitality Cleaning',
                            'Childcare & Elderly Home Cleaning',
                            'Not sure — recommend one for me'
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

CREATE INDEX IF NOT EXISTS idx_cleaner_apps_reference  ON cleaner_applications (reference_number);
CREATE INDEX IF NOT EXISTS idx_cleaner_apps_status     ON cleaner_applications (status);
CREATE INDEX IF NOT EXISTS idx_cleaner_apps_city       ON cleaner_applications (city);
CREATE INDEX IF NOT EXISTS idx_cleaner_apps_track      ON cleaner_applications (preferred_track);
CREATE INDEX IF NOT EXISTS idx_cleaner_apps_email      ON cleaner_applications (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_cleaner_apps_availability ON cleaner_applications USING GIN (availability);
CREATE INDEX IF NOT EXISTS idx_cleaner_apps_created    ON cleaner_applications (created_at DESC);

DROP TRIGGER IF EXISTS trg_cleaner_apps_updated_at ON cleaner_applications;
CREATE TRIGGER trg_cleaner_apps_updated_at
  BEFORE UPDATE ON cleaner_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();