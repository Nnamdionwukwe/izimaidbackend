-- db/seed/shelter.controller.sql
-- Matches: src/controllers/shelter.controller.js
--          src/models/ShelterApplication.js
-- Creates: shelter_applications

-- ══════════════════════════════════════════════════════════════════════
--  shelter_applications — organisations applying for shelter support
--  Public form, no user account required.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS shelter_applications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tracking reference, e.g. 'SHL-123456-789'
  reference_number   TEXT NOT NULL UNIQUE,

  -- Organisation + contact
  organisation_name  TEXT NOT NULL,
  contact_name       TEXT NOT NULL,
  email              TEXT NOT NULL,
  phone              TEXT NOT NULL,

  -- Location (fixed list — enforced in app)
  city               TEXT NOT NULL
                       CHECK (city IN ('Abuja','Lagos')),

  organisation_type  TEXT,          -- free-form (shelter, orphanage, etc.)

  -- Request details
  support_type       TEXT NOT NULL
                       CHECK (support_type IN (
                         'Shelter cleaning support',
                         'Youth / children''s home cleaning',
                         'Elderly care facility cleaning',
                         'Employment placement referral',
                         'Transitional housing clean',
                         'Individual family referral',
                         'General partnership enquiry'
                       )),
  resident_count     INTEGER,
  message            TEXT NOT NULL,

  -- Lifecycle
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','reviewed','approved','rejected','active')),

  -- Admin review
  admin_notes        TEXT,
  reviewed_at        TIMESTAMPTZ,
  reviewed_by        UUID REFERENCES users(id) ON DELETE SET NULL,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shelter_apps_reference  ON shelter_applications (reference_number);
CREATE INDEX IF NOT EXISTS idx_shelter_apps_status     ON shelter_applications (status);
CREATE INDEX IF NOT EXISTS idx_shelter_apps_city       ON shelter_applications (city);
CREATE INDEX IF NOT EXISTS idx_shelter_apps_support    ON shelter_applications (support_type);
CREATE INDEX IF NOT EXISTS idx_shelter_apps_email      ON shelter_applications (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_shelter_apps_created    ON shelter_applications (created_at DESC);

DROP TRIGGER IF EXISTS trg_shelter_apps_updated_at ON shelter_applications;
CREATE TRIGGER trg_shelter_apps_updated_at
  BEFORE UPDATE ON shelter_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();