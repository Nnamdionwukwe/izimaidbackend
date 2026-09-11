-- db/seed/chat.controller.sql
-- Matches: src/controllers/chat.controller.js
-- Creates: conversations, messages
-- NOTE: chat_messages (in live DB) is LEGACY — this controller never references it.
--       Safe to ignore, and probably worth dropping in a future migration.

-- ══════════════════════════════════════════════════════════════════════
--  conversations — chat threads
--  Two kinds:
--    • booking-scoped (booking_id NOT NULL, type='booking')
--    • inquiries    (booking_id NULL,     type='inquiry')
--  maid_id and customer_id both reference users.id (NOT maid_profiles.id)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS conversations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            UUID REFERENCES bookings(id) ON DELETE CASCADE,

  -- Participants (both users.id)
  customer_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  maid_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 'booking' for job chats, 'inquiry' for pre-booking Q&A
  type                  TEXT NOT NULL DEFAULT 'booking'
                          CHECK (type IN ('booking','inquiry')),

  -- Unread counters per party
  unread_customer       INTEGER NOT NULL DEFAULT 0,
  unread_maid           INTEGER NOT NULL DEFAULT 0,

  -- Per-party soft delete (customer and maid have independent inboxes)
  deleted_by_customer   BOOLEAN NOT NULL DEFAULT false,
  deleted_by_maid       BOOLEAN NOT NULL DEFAULT false,
  deleted_at_customer   TIMESTAMPTZ,
  deleted_at_maid       TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One booking = one conversation (booking-scoped)
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_booking_unique
  ON conversations (booking_id)
  WHERE booking_id IS NOT NULL;

-- One inquiry per (customer, maid) pair
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_inquiry_unique
  ON conversations (customer_id, maid_id)
  WHERE type = 'inquiry';

CREATE INDEX IF NOT EXISTS idx_conversations_customer   ON conversations (customer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_maid       ON conversations (maid_id);
CREATE INDEX IF NOT EXISTS idx_conversations_type       ON conversations (type);
CREATE INDEX IF NOT EXISTS idx_conversations_updated    ON conversations (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_cust_inbox ON conversations (customer_id, updated_at DESC)
  WHERE deleted_by_customer = false;
CREATE INDEX IF NOT EXISTS idx_conversations_maid_inbox ON conversations (maid_id, updated_at DESC)
  WHERE deleted_by_maid = false;

DROP TRIGGER IF EXISTS trg_conversations_updated_at ON conversations;
CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  messages — individual chat messages (text, image, video)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Text body OR caption/filename (nullable for media-only messages)
  content           TEXT,

  -- Media attachment (Cloudinary URL)
  media_url         TEXT,
  media_type        TEXT
                      CHECK (media_type IS NULL OR media_type IN ('image','video')),

  -- 'text' | 'image' | 'video'
  message_type      TEXT NOT NULL DEFAULT 'text'
                      CHECK (message_type IN ('text','image','video')),

  is_read           BOOLEAN NOT NULL DEFAULT false,

  -- Soft delete — content preserved for admin
  deleted_at        TIMESTAMPTZ,
  deleted_by        UUID REFERENCES users(id),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation  ON messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_sender        ON messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_unread        ON messages (conversation_id, is_read)
  WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_messages_deleted       ON messages (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════
--  Legacy table — NOT used by this controller.
--  Live DB has chat_messages; safely ignored. Comment included so we
--  remember to drop it in a later cleanup migration.
-- ══════════════════════════════════════════════════════════════════════
-- DROP TABLE IF EXISTS chat_messages;  -- ← leave commented; drop only when confirmed dead