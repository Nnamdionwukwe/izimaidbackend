-- db/seed/maid-support-tickets.controller.sql
-- Matches: src/controllers/maid-support-tickets.controller.js
-- Replaces stub: maid_support_tickets (from admin.sql)
-- Creates: maid_support_replies
-- NOTE: support_ticket_attachments is SHARED with customer-support-tickets
--       (ticket_type = 'maid').

-- ══════════════════════════════════════════════════════════════════════
--  maid_support_tickets — full schema
--  Uses `user_id` (NOT maid_id). Legacy `maid_id` retained for parity.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS maid_support_tickets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject           TEXT NOT NULL,
  message           TEXT NOT NULL,
  category          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','in_progress','resolved','closed')),
  priority          TEXT NOT NULL DEFAULT 'normal'
                      CHECK (priority IN ('low','normal','high','urgent')),
  admin_notes       TEXT,
  attachment_count  INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drift-repair (in case admin.sql stub is already applied with old columns)
ALTER TABLE maid_support_tickets ADD COLUMN IF NOT EXISTS user_id          UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE maid_support_tickets ADD COLUMN IF NOT EXISTS message          TEXT;
ALTER TABLE maid_support_tickets ADD COLUMN IF NOT EXISTS category         TEXT;
ALTER TABLE maid_support_tickets ADD COLUMN IF NOT EXISTS admin_notes      TEXT;
ALTER TABLE maid_support_tickets ADD COLUMN IF NOT EXISTS attachment_count INTEGER NOT NULL DEFAULT 0;

-- Backfill user_id from legacy maid_id if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='maid_support_tickets' AND column_name='maid_id'
  ) THEN
    EXECUTE 'UPDATE maid_support_tickets SET user_id = maid_id WHERE user_id IS NULL AND maid_id IS NOT NULL';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_maid_support_tickets_user    ON maid_support_tickets (user_id);
CREATE INDEX IF NOT EXISTS idx_maid_support_tickets_status  ON maid_support_tickets (status);
CREATE INDEX IF NOT EXISTS idx_maid_support_tickets_cat     ON maid_support_tickets (category);
CREATE INDEX IF NOT EXISTS idx_maid_support_tickets_created ON maid_support_tickets (created_at DESC);

DROP TRIGGER IF EXISTS trg_maid_support_tickets_updated_at ON maid_support_tickets;
CREATE TRIGGER trg_maid_support_tickets_updated_at
  BEFORE UPDATE ON maid_support_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  maid_support_replies — replies on maid tickets
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS maid_support_replies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID NOT NULL REFERENCES maid_support_tickets(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message      TEXT NOT NULL,
  is_internal  BOOLEAN NOT NULL DEFAULT false,   -- mirror of customer version
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drift-repair
ALTER TABLE maid_support_replies ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_maid_support_replies_ticket ON maid_support_replies (ticket_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_maid_support_replies_user   ON maid_support_replies (user_id);

-- ══════════════════════════════════════════════════════════════════════
--  No seed data — per-user transactional table
-- ══════════════════════════════════════════════════════════════════════