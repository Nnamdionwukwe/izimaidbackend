-- db/seed/leads.controller.sql
-- Matches: src/controllers/leads.controller.js
-- Creates: leads
-- NOTE: This controller has NO dependencies on other tables — fully standalone.

-- ══════════════════════════════════════════════════════════════════════
--  leads — pre-signup quote requests / landing page submissions
--  Does NOT reference users — these are prospects, not accounts.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS leads (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Contact info
  first_name                  TEXT NOT NULL,
  last_name                   TEXT NOT NULL,
  email                       TEXT NOT NULL,
  phone_number                TEXT NOT NULL,
  text_me_messages            BOOLEAN NOT NULL DEFAULT false,

  -- Address
  zip_code                    TEXT NOT NULL,
  service_address             TEXT NOT NULL,
  apartment_suite             TEXT,

  -- Service shape
  cleaning_type               TEXT NOT NULL DEFAULT 'residential'
                                CHECK (cleaning_type IN ('residential','light_commercial')),
  frequency                   TEXT NOT NULL DEFAULT 'recurring'
                                CHECK (frequency IN ('recurring','one_time','move_in_out')),

  -- Residential details
  residential_sqft            TEXT,              -- stored as range string, e.g. "1000-1500"
  bedrooms                    INTEGER,
  bathrooms                   INTEGER,
  recurring_plan              TEXT,

  -- Commercial details
  commercial_sqft             TEXT,
  offices                     INTEGER,
  commercial_bathrooms        INTEGER,
  commercial_frequency        TEXT,
  is_move_in_out              BOOLEAN NOT NULL DEFAULT false,

  -- Lead lifecycle
  status                      TEXT NOT NULL DEFAULT 'new'
                                CHECK (status IN ('new','contacted','converted','lost')),
  notes                       TEXT,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_status  ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_email   ON leads (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_leads_phone   ON leads (phone_number);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at DESC);

DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();