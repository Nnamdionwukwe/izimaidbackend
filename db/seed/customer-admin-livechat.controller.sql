-- db/seed/customer-admin-livechat.controller.sql
-- Matches: src/controllers/customer-admin-livechat.controller.js
-- Creates: support_conversations, support_messages
-- NOTE: These are ACTIVE tables — not legacy. Symmetric with maid-admin-livechat.

-- ══════════════════════════════════════════════════════════════════════
--  support_conversations — customer ↔ admin support chats
--  One conversation per customer (get-or-create pattern)
--  Parallel to `conversations` but without maid_id / booking_id / type
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS support_conversations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- Unread counters per party
  unread_customer       INTEGER NOT NULL DEFAULT 0,
  unread_admin          INTEGER NOT NULL DEFAULT 0,

  -- Customer-only soft-delete (admins never delete)
  deleted_by_customer   BOOLEAN NOT NULL DEFAULT false,
  deleted_at_customer   TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_conversations_customer ON support_conversations (customer_id);
CREATE INDEX IF NOT EXISTS idx_support_conversations_updated  ON support_conversations (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_conversations_inbox    ON support_conversations (updated_at DESC)
  WHERE deleted_by_customer = false;

DROP TRIGGER IF EXISTS trg_support_conversations_updated_at ON support_conversations;
CREATE TRIGGER trg_support_conversations_updated_at
  BEFORE UPDATE ON support_conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  support_messages — messages within support chats
--  Mirror of `messages` but only customer/admin senders (no maid).
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS support_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  sender_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  content           TEXT,
  media_url         TEXT,
  media_type        TEXT
                      CHECK (media_type IS NULL OR media_type IN ('image','video')),
  message_type      TEXT NOT NULL DEFAULT 'text'
                      CHECK (message_type IN ('text','image','video')),

  is_read           BOOLEAN NOT NULL DEFAULT false,

  -- Soft delete — content preserved for admin
  deleted_at        TIMESTAMPTZ,
  deleted_by        UUID REFERENCES users(id),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_conversation ON support_messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_support_messages_sender       ON support_messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_unread       ON support_messages (conversation_id, is_read)
  WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_support_messages_deleted      ON support_messages (deleted_at)
  WHERE deleted_at IS NOT NULL;