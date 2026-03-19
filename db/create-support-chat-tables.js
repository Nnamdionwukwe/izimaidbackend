// run with: node db/create-support-chat-tables.js

import { config } from "dotenv";
config();

import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const maskedUrl = process.env.DATABASE_URL?.replace(/:([^:@]{4,})@/, ":****@");
console.log("→ Connecting to:", maskedUrl);

async function columnExists(client, table, column) {
  const res = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return res.rows.length > 0;
}

async function indexExists(client, name) {
  const res = await client.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
    [name],
  );
  return res.rows.length > 0;
}

async function constraintExists(client, name) {
  const res = await client.query(
    `SELECT 1 FROM pg_constraint WHERE conname = $1`,
    [name],
  );
  return res.rows.length > 0;
}

async function run() {
  const client = await pool.connect();
  console.log("✓ Connected to database\n");

  try {
    await client.query("BEGIN");

    // ── 1. support_conversations ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS support_conversations (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        unread_customer      INTEGER     NOT NULL DEFAULT 0,
        unread_admin         INTEGER     NOT NULL DEFAULT 0,
        deleted_by_customer  BOOLEAN     NOT NULL DEFAULT false,
        deleted_at_customer  TIMESTAMPTZ,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✓ support_conversations table ensured");

    // One support thread per customer
    if (
      !(await constraintExists(client, "support_conversations_customer_id_key"))
    ) {
      await client.query(
        `ALTER TABLE support_conversations
         ADD CONSTRAINT support_conversations_customer_id_key UNIQUE (customer_id)`,
      );
      console.log("✓ unique constraint on support_conversations.customer_id");
    } else {
      console.log("✓ unique constraint already exists — skipped");
    }

    // ── 2. support_messages ───────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS support_messages (
        id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id  UUID        NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
        sender_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content          TEXT,
        message_type     VARCHAR(10) NOT NULL DEFAULT 'text',
        media_url        TEXT,
        media_type       VARCHAR(10),
        is_read          BOOLEAN     NOT NULL DEFAULT false,
        deleted_at       TIMESTAMPTZ,
        deleted_by       UUID        REFERENCES users(id) ON DELETE SET NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_support_message_content CHECK (
          (message_type = 'text'  AND content   IS NOT NULL) OR
          (message_type != 'text' AND media_url IS NOT NULL)
        )
      )
    `);
    console.log("✓ support_messages table ensured");

    // ── 3. Add any missing columns (idempotent) ───────────────────────

    const supportConvColumns = [
      ["unread_customer", "INTEGER     NOT NULL DEFAULT 0"],
      ["unread_admin", "INTEGER     NOT NULL DEFAULT 0"],
      ["deleted_by_customer", "BOOLEAN     NOT NULL DEFAULT false"],
      ["deleted_at_customer", "TIMESTAMPTZ"],
    ];

    for (const [col, def] of supportConvColumns) {
      if (!(await columnExists(client, "support_conversations", col))) {
        await client.query(
          `ALTER TABLE support_conversations ADD COLUMN ${col} ${def}`,
        );
        console.log(`✓ added support_conversations.${col}`);
      } else {
        console.log(`✓ support_conversations.${col} already exists — skipped`);
      }
    }

    const supportMsgColumns = [
      ["content", "TEXT"],
      ["message_type", "VARCHAR(10) NOT NULL DEFAULT 'text'"],
      ["media_url", "TEXT"],
      ["media_type", "VARCHAR(10)"],
      ["is_read", "BOOLEAN NOT NULL DEFAULT false"],
      ["deleted_at", "TIMESTAMPTZ"],
      ["deleted_by", "UUID REFERENCES users(id) ON DELETE SET NULL"],
    ];

    for (const [col, def] of supportMsgColumns) {
      if (!(await columnExists(client, "support_messages", col))) {
        await client.query(
          `ALTER TABLE support_messages ADD COLUMN ${col} ${def}`,
        );
        console.log(`✓ added support_messages.${col}`);
      } else {
        console.log(`✓ support_messages.${col} already exists — skipped`);
      }
    }

    // ── 4. chk_support_message_content constraint ────────────────────
    if (!(await constraintExists(client, "chk_support_message_content"))) {
      await client.query(`
        ALTER TABLE support_messages
        ADD CONSTRAINT chk_support_message_content CHECK (
          (message_type = 'text'  AND content   IS NOT NULL) OR
          (message_type != 'text' AND media_url IS NOT NULL)
        )
      `);
      console.log("✓ chk_support_message_content constraint added");
    } else {
      console.log(
        "✓ chk_support_message_content constraint already exists — skipped",
      );
    }

    // ── 5. Indexes ────────────────────────────────────────────────────
    const indexes = [
      [
        "idx_support_conv_customer",
        `CREATE INDEX idx_support_conv_customer ON support_conversations(customer_id)`,
      ],
      [
        "idx_support_conv_updated",
        `CREATE INDEX idx_support_conv_updated  ON support_conversations(updated_at DESC)`,
      ],
      [
        "idx_support_msg_conv_id",
        `CREATE INDEX idx_support_msg_conv_id   ON support_messages(conversation_id)`,
      ],
      [
        "idx_support_msg_sender",
        `CREATE INDEX idx_support_msg_sender    ON support_messages(sender_id)`,
      ],
      [
        "idx_support_msg_created",
        `CREATE INDEX idx_support_msg_created   ON support_messages(created_at ASC)`,
      ],
      [
        "idx_support_msg_unread",
        `CREATE INDEX idx_support_msg_unread    ON support_messages(conversation_id, is_read) WHERE is_read = false`,
      ],
    ];

    for (const [name, sql] of indexes) {
      if (!(await indexExists(client, name))) {
        await client.query(sql);
        console.log(`✓ created index ${name}`);
      } else {
        console.log(`✓ index ${name} already exists — skipped`);
      }
    }

    await client.query("COMMIT");
    console.log("\n✅ Support chat migration completed successfully");

    // ── Verification ──────────────────────────────────────────────────
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('support_conversations', 'support_messages')
      ORDER BY table_name
    `);
    console.log(
      "\n✓ Tables confirmed:",
      tables.rows.map((r) => r.table_name).join(", "),
    );

    const cols = await client.query(`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('support_conversations', 'support_messages')
      ORDER BY table_name, ordinal_position
    `);

    console.log("\n── Column report ────────────────────────────────────────");
    let lastTable = "";
    for (const r of cols.rows) {
      if (r.table_name !== lastTable) {
        console.log(`\n  ${r.table_name}`);
        lastTable = r.table_name;
      }
      console.log(
        `    ${r.column_name.padEnd(22)} ${r.data_type.padEnd(20)} nullable: ${r.is_nullable}${r.column_default ? `  default: ${r.column_default}` : ""}`,
      );
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n❌ Migration failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
