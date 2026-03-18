// run with: node db/create-support-tables.js

import { config } from "dotenv";
config(); // must be before any db import

import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Mask password in log so you can confirm it's hitting Railway
const maskedUrl = process.env.DATABASE_URL?.replace(/:([^:@]{4,})@/, ":****@");
console.log("→ Connecting to:", maskedUrl);

async function run() {
  const client = await pool.connect();
  console.log("✓ Connected to database");

  try {
    await client.query("BEGIN");

    // 1. Main tickets table
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_support_tickets (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject          VARCHAR(255) NOT NULL,
        message          TEXT NOT NULL,
        category         VARCHAR(50) NOT NULL,
        priority         VARCHAR(20) NOT NULL DEFAULT 'normal',
        status           VARCHAR(20) NOT NULL DEFAULT 'open',
        admin_notes      TEXT,
        attachment_count INTEGER NOT NULL DEFAULT 0,
        created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✓ customer_support_tickets");

    // 2. Replies table
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_support_replies (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id  UUID NOT NULL REFERENCES customer_support_tickets(id) ON DELETE CASCADE,
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message    TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✓ customer_support_replies");

    // 3. Attachments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS support_ticket_attachments (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id   UUID NOT NULL,
        ticket_type VARCHAR(20) NOT NULL DEFAULT 'customer',
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_url   TEXT NOT NULL,
        media_type  VARCHAR(10) NOT NULL DEFAULT 'image',
        file_name   VARCHAR(255),
        file_size   INTEGER,
        created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✓ support_ticket_attachments");

    // 4. Indexes
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_cst_user_id   ON customer_support_tickets(user_id)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_cst_status    ON customer_support_tickets(status)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_csr_ticket_id ON customer_support_replies(ticket_id)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_sta_ticket_id ON support_ticket_attachments(ticket_id)`,
    );
    console.log("✓ indexes");

    await client.query("COMMIT");
    console.log("\n✅ All support tables created successfully");
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
