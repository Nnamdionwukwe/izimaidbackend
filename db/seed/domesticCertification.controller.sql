-- db/seed/domesticCertification.controller.sql
-- Matches: src/controllers/domesticCertification.controller.js
--          src/models/DomesticCertificationApplication.js
-- Creates: domestic_certification_applications

-- ══════════════════════════════════════════════════════════════════════
--  domestic_certification_applications — domestic certification applications
--  Public form, no user account required.
--  Has more optional fields than the other training programs (education,
--  referral, emergency contact, hear-about).
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS domestic_certification_applications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tracking reference, e.g. 'DSA-123456-789'
  reference_number      TEXT NOT NULL UNIQUE,

  -- Applicant info
  full_name             TEXT NOT NULL,
  email                 TEXT NOT NULL,
  phone                 TEXT NOT NULL,

  -- Location (9 detailed city-area values)
  city                  TEXT NOT NULL
                          CHECK (city IN (
                            'Lagos (Ikoyi, VI, Lekki)',
                            'Lagos (Ikeja, GRA)',
                            'Lagos (Surulere, Yaba)',
                            'Abuja (Maitama, Asokoro)',
                            'Abuja (Wuse, Garki)',
                            'Port Harcourt (GRA)',
                            'Ibadan (Jericho, Bodija)',
                            'Kano (Nassarawa GRA)',
                            'Enugu (Independence Layout)'
                          )),

  -- Program of interest
  program_choice        TEXT NOT NULL
                          CHECK (program_choice IN (
                            'Household Management',
                            'Professional Cooking & Culinary',
                            'Professional Childcare',
                            'Elderly Companion Care',
                            'Laundry & Textile Care',
                            'Hospitality & Service'
                          )),

  -- Background
  experience_level      TEXT
                          CHECK (experience_level IS NULL OR experience_level IN (
                            'none','less1','1-2','3-5','5+'
                          )),
  education_level       TEXT
                          CHECK (education_level IS NULL OR education_level IN (
                            'primary','secondary','diploma','degree','postgraduate'
                          )),
  previous_training     TEXT,

  -- Logistics
  schedule_preference   TEXT
                          CHECK (schedule_preference IS NULL OR schedule_preference IN (
                            'Full-time (Mon-Thu 9AM-3PM) - 4 weeks',
                            'Part-time (Mon-Wed 6PM-9PM) - 8 weeks',
                            'Weekend (Sat-Sun 10AM-4PM) - 8 weeks',
                            'Flexible (Self-paced with labs) - Up to 12 weeks'
                          )),
  start_month           TEXT,

  -- Application body
  motivation            TEXT NOT NULL,
  referral_code         TEXT,
  hear_about            TEXT,

  -- Emergency contact
  emergency_contact     TEXT,
  emergency_phone       TEXT,

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

CREATE INDEX IF NOT EXISTS idx_domestic_cert_apps_reference  ON domestic_certification_applications (reference_number);
CREATE INDEX IF NOT EXISTS idx_domestic_cert_apps_status     ON domestic_certification_applications (status);
CREATE INDEX IF NOT EXISTS idx_domestic_cert_apps_city       ON domestic_certification_applications (city);
CREATE INDEX IF NOT EXISTS idx_domestic_cert_apps_program    ON domestic_certification_applications (program_choice);
CREATE INDEX IF NOT EXISTS idx_domestic_cert_apps_email      ON domestic_certification_applications (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_domestic_cert_apps_referral   ON domestic_certification_applications (referral_code)
  WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_domestic_cert_apps_created    ON domestic_certification_applications (created_at DESC);

DROP TRIGGER IF EXISTS trg_domestic_cert_apps_updated_at ON domestic_certification_applications;
CREATE TRIGGER trg_domestic_cert_apps_updated_at
  BEFORE UPDATE ON domestic_certification_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();