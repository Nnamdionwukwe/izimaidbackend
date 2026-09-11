-- db/seed/caregiverTraining.controller.sql
-- Matches: src/controllers/caregiverTraining.controller.js
--          src/models/CaregiverApplication.js
-- Creates: caregiver_applications

-- ══════════════════════════════════════════════════════════════════════
--  caregiver_applications — caregiver training program applications
--  Public form, no user account required.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS caregiver_applications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tracking reference, e.g. 'CGC-123456-789'
  reference_number      TEXT NOT NULL UNIQUE,

  -- Applicant info
  full_name             TEXT NOT NULL,
  email                 TEXT NOT NULL,
  phone                 TEXT NOT NULL,

  -- Location (8 valid cities)
  city                  TEXT NOT NULL
                          CHECK (city IN (
                            'Lagos','Abuja','Port Harcourt','Ibadan',
                            'Kano','Enugu','Abeokuta','Benin City'
                          )),

  -- Course of interest
  preferred_course      TEXT NOT NULL
                          CHECK (preferred_course IN (
                            'Foundation in Caregiving',
                            'Senior Care Specialist',
                            'Pediatric Care',
                            'Mental Health Support'
                          )),

  -- Background
  experience_level      TEXT
                          CHECK (experience_level IS NULL OR experience_level IN (
                            'none','family','volunteer','professional','experienced'
                          )),

  motivation            TEXT NOT NULL,

  schedule_preference   TEXT
                          CHECK (schedule_preference IS NULL OR schedule_preference IN (
                            'Weekdays (Mon-Thu 9AM-1PM)',
                            'Weekdays (Mon-Thu 6PM-10PM)',
                            'Weekends (Sat-Sun 10AM-4PM)',
                            'Flexible (Self-paced + Labs)'
                          )),

  -- Lifecycle
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','reviewed','accepted','rejected','enrolled')),

  -- Admin review
  admin_notes           TEXT,
  reviewed_at           TIMESTAMPTZ,
  reviewed_by           UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Application date (explicit — the model reads this)
  application_date      TIMESTAMPTZ NOT NULL DEFAULT now(),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caregiver_apps_reference  ON caregiver_applications (reference_number);
CREATE INDEX IF NOT EXISTS idx_caregiver_apps_status     ON caregiver_applications (status);
CREATE INDEX IF NOT EXISTS idx_caregiver_apps_city       ON caregiver_applications (city);
CREATE INDEX IF NOT EXISTS idx_caregiver_apps_course     ON caregiver_applications (preferred_course);
CREATE INDEX IF NOT EXISTS idx_caregiver_apps_email      ON caregiver_applications (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_caregiver_apps_created    ON caregiver_applications (created_at DESC);

DROP TRIGGER IF EXISTS trg_caregiver_apps_updated_at ON caregiver_applications;
CREATE TRIGGER trg_caregiver_apps_updated_at
  BEFORE UPDATE ON caregiver_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  