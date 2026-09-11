-- db/seed/customer-support-tickets.controller.sql
-- Matches: src/controllers/customer-support-tickets.controller.js
-- Creates: customer_support_replies, support_ticket_attachments
-- Replaces stub: customer_support_tickets (from admin.sql)
-- NOTE: support_ticket_attachments is SHARED between customer and maid tickets.

-- ══════════════════════════════════════════════════════════════════════
--  customer_support_tickets — full schema
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS customer_support_tickets (
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

-- Drift-repair
ALTER TABLE customer_support_tickets ADD COLUMN IF NOT EXISTS message          TEXT;
ALTER TABLE customer_support_tickets ADD COLUMN IF NOT EXISTS category         TEXT;
ALTER TABLE customer_support_tickets ADD COLUMN IF NOT EXISTS admin_notes      TEXT;
ALTER TABLE customer_support_tickets ADD COLUMN IF NOT EXISTS attachment_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_customer_support_tickets_user    ON customer_support_tickets (user_id);
CREATE INDEX IF NOT EXISTS idx_customer_support_tickets_status  ON customer_support_tickets (status);
CREATE INDEX IF NOT EXISTS idx_customer_support_tickets_cat     ON customer_support_tickets (category);
CREATE INDEX IF NOT EXISTS idx_customer_support_tickets_created ON customer_support_tickets (created_at DESC);

DROP TRIGGER IF EXISTS trg_customer_support_tickets_updated_at ON customer_support_tickets;
CREATE TRIGGER trg_customer_support_tickets_updated_at
  BEFORE UPDATE ON customer_support_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  customer_support_replies — replies on customer tickets
--  is_internal = true marks admin-only notes hidden from the customer
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS customer_support_replies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID NOT NULL REFERENCES customer_support_tickets(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message      TEXT NOT NULL,
  is_internal  BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drift-repair
ALTER TABLE customer_support_replies ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_customer_support_replies_ticket ON customer_support_replies (ticket_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_customer_support_replies_user   ON customer_support_replies (user_id);

-- ══════════════════════════════════════════════════════════════════════
--  support_ticket_attachments — SHARED between customer and maid tickets
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS support_ticket_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID NOT NULL,
  ticket_type  TEXT NOT NULL
                 CHECK (ticket_type IN ('customer','maid')),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  media_url    TEXT NOT NULL,
  media_type   TEXT NOT NULL
                 CHECK (media_type IN ('image','video')),
  file_name    TEXT,
  file_size    BIGINT,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_att_ticket  ON support_ticket_attachments (ticket_type, ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_att_user    ON support_ticket_attachments (user_id);
CREATE INDEX IF NOT EXISTS idx_support_att_created ON support_ticket_attachments (created_at DESC);