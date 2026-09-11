-- db/seed/maid-admin-livechat.controller.sql
-- Matches: src/controllers/maid-admin-livechat.controller.js
-- Creates: maid_support_conversations, maid_support_messages
-- NOTE: Active tables (not legacy). Symmetric with customer-admin-livechat.

-- ══════════════════════════════════════════════════════════════════════
--  maid_support_conversations — maid ↔ admin support chats
--  One conversation per maid (get-or-create pattern)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS maid_support_conversations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maid_id               UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  unread_maid           INTEGER NOT NULL DEFAULT 0,
  unread_admin          INTEGER NOT NULL DEFAULT 0,

  -- Maid-only soft delete (admins never delete)
  deleted_by_maid       BOOLEAN NOT NULL DEFAULT false,
  deleted_at_maid       TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maid_support_conversations_maid    ON maid_support_conversations (maid_id);
CREATE INDEX IF NOT EXISTS idx_maid_support_conversations_updated ON maid_support_conversations (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_maid_support_conversations_inbox   ON maid_support_conversations (updated_at DESC)
  WHERE deleted_by_maid = false;

DROP TRIGGER IF EXISTS trg_maid_support_conversations_updated_at ON maid_support_conversations;
CREATE TRIGGER trg_maid_support_conversations_updated_at
  BEFORE UPDATE ON maid_support_conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  maid_support_messages — messages within maid support chats
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS maid_support_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES maid_support_conversations(id) ON DELETE CASCADE,
  sender_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  content           TEXT,
  media_url         TEXT,
  media_type        TEXT
                      CHECK (media_type IS NULL OR media_type IN ('image','video')),
  message_type      TEXT NOT NULL DEFAULT 'text'
                      CHECK (message_type IN ('text','image','video')),

  is_read           BOOLEAN NOT NULL DEFAULT false,

  deleted_at        TIMESTAMPTZ,
  deleted_by        UUID REFERENCES users(id),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maid_support_messages_conversation ON maid_support_messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_maid_support_messages_sender       ON maid_support_messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_maid_support_messages_unread       ON maid_support_messages (conversation_id, is_read)
  WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_maid_support_messages_deleted      ON maid_support_messages (deleted_at)
  WHERE deleted_at IS NOT NULL;