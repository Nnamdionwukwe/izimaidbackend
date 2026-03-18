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
        unread_customer  INTEGER NOT NULL DEFAULT 0,
        unread_maid      INTEGER NOT NULL DEFAULT 0,
        created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(booking_id)
      )
    `);
    console.log("✓ conversations");

    // 2. Messages table
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content          TEXT NOT NULL,
        message_type     VARCHAR(10) NOT NULL DEFAULT 'text',  -- 'text' | 'image' | 'video'
        media_url        TEXT,
        media_type       VARCHAR(10),                          -- 'image' | 'video'
        is_read          BOOLEAN NOT NULL DEFAULT false,
        created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
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
