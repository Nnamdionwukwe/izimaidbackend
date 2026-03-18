#!/usr/bin/env node

import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

pool.on("connect", () => {
  console.log("✓ Postgres connected");
});

pool.on("error", (err) => {
  console.error("✗ Postgres client error:", err);
});

async function createMaidSupportTables() {
  try {
    console.log(
      "\n═══════════════════════════════════════════════════════════",
    );
    console.log("🚀 Creating Maid Support Tables with Media Attachments");
    console.log(
      "═══════════════════════════════════════════════════════════\n",
    );

    // Check database connection
    const connCheck = await pool.query(
      "SELECT current_database() as database;",
    );
    console.log(`📊 Connected to database: ${connCheck.rows[0].database}\n`);

    // 1. Create maid_support_tickets table
    console.log("📝 Creating maid_support_tickets table...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS maid_support_tickets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        category VARCHAR(50) NOT NULL,
        priority VARCHAR(20) DEFAULT 'normal',
        status VARCHAR(20) DEFAULT 'open',
        admin_notes TEXT,
        attachment_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT valid_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
        CONSTRAINT valid_status CHECK (status IN ('open', 'in_progress', 'resolved', 'closed'))
      );
    `);
    console.log("✅ maid_support_tickets table created\n");

    // 2. Create maid_support_replies table
    console.log("📝 Creating maid_support_replies table...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS maid_support_replies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id UUID NOT NULL REFERENCES maid_support_tickets(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ maid_support_replies table created\n");

    // 3. Create support_ticket_attachments table (shared with customer support)
    console.log("📝 Creating support_ticket_attachments table...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS support_ticket_attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id UUID NOT NULL,
        ticket_type VARCHAR(20) NOT NULL,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_url VARCHAR(1000) NOT NULL,
        media_type VARCHAR(20) NOT NULL,
        file_name VARCHAR(255),
        file_size INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT valid_ticket_type CHECK (ticket_type IN ('customer', 'maid')),
        CONSTRAINT valid_media_type CHECK (media_type IN ('image', 'video'))
      );
    `);
    console.log("✅ support_ticket_attachments table created\n");

    // 4. Create indexes for maid_support_tickets
    console.log("📊 Creating indexes for maid_support_tickets...");
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_maid_support_tickets_user_id 
      ON maid_support_tickets(user_id);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_maid_support_tickets_status 
      ON maid_support_tickets(status);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_maid_support_tickets_category 
      ON maid_support_tickets(category);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_maid_support_tickets_created_at 
      ON maid_support_tickets(created_at);
    `);
    console.log("✅ Indexes created for maid_support_tickets\n");

    // 5. Create indexes for maid_support_replies
    console.log("📊 Creating indexes for maid_support_replies...");
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_maid_support_replies_ticket_id 
      ON maid_support_replies(ticket_id);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_maid_support_replies_user_id 
      ON maid_support_replies(user_id);
    `);
    console.log("✅ Indexes created for maid_support_replies\n");

    // 6. Create indexes for support_ticket_attachments
    console.log("📊 Creating indexes for support_ticket_attachments...");
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_ticket_id 
      ON support_ticket_attachments(ticket_id);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_user_id 
      ON support_ticket_attachments(user_id);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_created_at 
      ON support_ticket_attachments(created_at);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_ticket_type 
      ON support_ticket_attachments(ticket_type);
    `);
    console.log("✅ Indexes created for support_ticket_attachments\n");

    // Verify tables were created
    console.log("═══════════════════════════════════════════════════════════");
    console.log("✨ Database seeding completed successfully!");
    console.log(
      "═══════════════════════════════════════════════════════════\n",
    );

    console.log("📊 Tables created:");
    console.log("  ✅ maid_support_tickets");
    console.log("  ✅ maid_support_replies");
    console.log("  ✅ support_ticket_attachments\n");

    console.log("📊 Indexes created:");
    console.log("  ✅ All maid_support_tickets indexes");
    console.log("  ✅ All maid_support_replies indexes");
    console.log("  ✅ All support_ticket_attachments indexes\n");

    console.log("🎯 Ready to use! Your support system is now set up.\n");

    process.exit(0);
  } catch (err) {
    console.error("\n❌ Error during database seeding:", err.message);
    console.error("\nError details:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the migration
createMaidSupportTables();
