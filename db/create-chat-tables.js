// run with: node db/create-chat-tables.js

import { config } from "dotenv";
config();

import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const maskedUrl = process.env.DATABASE_URL?.replace(/:([^:@]{4,})@/, ":****@");
console.log("→ Connecting to:", maskedUrl);

async function run() {
  const client = await pool.connect();
  console.log("✓ Connected to database");

  try {
    await client.query("BEGIN");

    // 1. Conversations table — one per booking
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id       UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        customer_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        maid_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        unread_customer      INTEGER NOT NULL DEFAULT 0,
        unread_maid          INTEGER NOT NULL DEFAULT 0,
        deleted_by_customer  BOOLEAN NOT NULL DEFAULT false,
        deleted_by_maid      BOOLEAN NOT NULL DEFAULT false,
        deleted_at_customer  TIMESTAMP WITH TIME ZONE,
        deleted_at_maid      TIMESTAMP WITH TIME ZONE,
        created_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✓ conversations");

    // Add UNIQUE constraint on booking_id only if it doesn't already exist
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'conversations_booking_id_key'
        ) THEN
          ALTER TABLE conversations ADD CONSTRAINT conversations_booking_id_key UNIQUE (booking_id);
        END IF;
      END$$;
    `);
    console.log("✓ conversations unique constraint");

    // 2. Messages table
    //    content is nullable — media-only messages have no text
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content          TEXT,                                        -- nullable: media messages may have no caption
        message_type     VARCHAR(10) NOT NULL DEFAULT 'text',         -- 'text' | 'image' | 'video'
        media_url        TEXT,
        media_type       VARCHAR(10),                                 -- 'image' | 'video'
        is_read          BOOLEAN NOT NULL DEFAULT false,
        deleted_at       TIMESTAMP WITH TIME ZONE,           -- soft-delete timestamp
        deleted_by       UUID REFERENCES users(id),          -- who deleted it
        created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        -- enforce: text messages must have content, media messages must have media_url
        CONSTRAINT chk_message_content CHECK (
          (message_type = 'text'  AND content   IS NOT NULL) OR
          (message_type != 'text' AND media_url IS NOT NULL)
        )
      )
    `);
    console.log("✓ messages");

    // 3. Indexes for fast lookups
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_conv_booking     ON conversations(booking_id)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_conv_customer    ON conversations(customer_id)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_conv_maid        ON conversations(maid_id)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_conv_updated     ON conversations(updated_at DESC)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_msg_conv_id      ON messages(conversation_id)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_msg_sender       ON messages(sender_id)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_msg_created      ON messages(created_at ASC)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_msg_unread       ON messages(conversation_id, is_read) WHERE is_read = false`,
    );
    console.log("✓ indexes");

    await client.query("COMMIT");
    console.log("\n✅ Chat tables created successfully");

    // Add soft-delete columns to existing messages table if they don't exist
    await client.query(`
      ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id)
    `);
    console.log("✓ messages soft-delete columns");

    // Add soft-delete columns to existing conversations table if they don't exist
    await client.query(`
      ALTER TABLE conversations
        ADD COLUMN IF NOT EXISTS deleted_by_customer BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS deleted_by_maid     BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS deleted_at_customer TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS deleted_at_maid     TIMESTAMP WITH TIME ZONE
    `);
    console.log("✓ soft-delete columns");

    // Quick verification
    const check = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('conversations', 'messages')
      ORDER BY table_name
    `);
    console.log(
      "✓ Tables confirmed:",
      check.rows.map((r) => r.table_name).join(", "),
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n❌ Migration failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
