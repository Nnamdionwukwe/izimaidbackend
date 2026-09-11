-- db/seed/contact.controller.sql
-- Matches: src/controllers/contact.controller.js
--          src/models/ContactMessage.js
-- Creates: contact_messages

-- ══════════════════════════════════════════════════════════════════════
--  contact_messages — public contact form submissions
--  No FK to users — anonymous visitors can submit.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS contact_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reference number for tracking, e.g. 'CMS-123456-789'
  reference_number  TEXT NOT NULL UNIQUE,

  -- Sender details (anonymous — not linked to users table)
  full_name         TEXT NOT NULL,
  email             TEXT NOT NULL,
  phone             TEXT,

  -- Message content
  subject           TEXT NOT NULL,
  message           TEXT NOT NULL,

  -- Lifecycle
  status            TEXT NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new','read','replied','resolved','archived')),

  -- Admin tracking
  admin_notes       TEXT,
  replied_at        TIMESTAMPTZ,
  replied_by        UUID REFERENCES users(id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_email      ON contact_messages (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_contact_messages_status     ON contact_messages (status);
CREATE INDEX IF NOT EXISTS idx_contact_messages_subject    ON contact_messages (subject);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created    ON contact_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_reference  ON contact_messages (reference_number);

DROP TRIGGER IF EXISTS trg_contact_messages_updated_at ON contact_messages;
CREATE TRIGGER trg_contact_messages_updated_at
  BEFORE UPDATE ON contact_messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();