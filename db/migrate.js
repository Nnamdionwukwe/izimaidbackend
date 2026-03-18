import db from "../src/config/database.js";

async function seedDatabase() {
  try {
    console.log(
      "🚀 Starting database seeding for support system with media...\n",
    );

    // Check which database we're connected to
    const dbResult = await db.query("SELECT current_database() as database;");
    console.log(`📊 Connected to database: ${dbResult.rows[0].database}\n`);

    // Create customer_support_tickets table
    console.log("📝 Creating customer_support_tickets table...");
    await db.query(`
      CREATE TABLE IF NOT EXISTS customer_support_tickets (
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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ customer_support_tickets table created\n");

    // Create customer_support_replies table
    console.log("📝 Creating customer_support_replies table...");
    await db.query(`
      CREATE TABLE IF NOT EXISTS customer_support_replies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id UUID NOT NULL REFERENCES customer_support_tickets(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ customer_support_replies table created\n");

    // Create maid_support_tickets table
    console.log("📝 Creating maid_support_tickets table...");
    await db.query(`
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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ maid_support_tickets table created\n");

    // Create maid_support_replies table
    console.log("📝 Creating maid_support_replies table...");
    await db.query(`
      CREATE TABLE IF NOT EXISTS maid_support_replies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id UUID NOT NULL REFERENCES maid_support_tickets(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ maid_support_replies table created\n");

    // Create support_ticket_attachments table
    console.log("📝 Creating support_ticket_attachments table...");
    await db.query(`
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

    // Create indexes for customer support
    console.log("📊 Creating indexes for customer support tables...");
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_support_tickets_user_id 
      ON customer_support_tickets(user_id);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_support_tickets_status 
      ON customer_support_tickets(status);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_support_tickets_category 
      ON customer_support_tickets(category);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_support_tickets_created_at 
      ON customer_support_tickets(created_at);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_support_replies_ticket_id 
      ON customer_support_replies(ticket_id);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_customer_support_replies_user_id 
      ON customer_support_replies(user_id);
    `);
    console.log("✅ Customer support indexes created\n");

    // Create indexes for maid support
    console.log("📊 Creating indexes for maid support tables...");
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_maid_support_tickets_user_id 
      ON maid_support_tickets(user_id);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_maid_support_tickets_status 
      ON maid_support_tickets(status);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_maid_support_tickets_category 
      ON maid_support_tickets(category);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_maid_support_tickets_created_at 
      ON maid_support_tickets(created_at);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_maid_support_replies_ticket_id 
      ON maid_support_replies(ticket_id);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_maid_support_replies_user_id 
      ON maid_support_replies(user_id);
    `);
    console.log("✅ Maid support indexes created\n");

    // Create indexes for attachments
    console.log("📊 Creating indexes for attachments table...");
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_ticket_id 
      ON support_ticket_attachments(ticket_id);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_user_id 
      ON support_ticket_attachments(user_id);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_created_at 
      ON support_ticket_attachments(created_at);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_ticket_type 
      ON support_ticket_attachments(ticket_type);
    `);
    console.log("✅ Attachment indexes created\n");

    console.log("════════════════════════════════════════");
    console.log("✨ Database seeding completed successfully!");
    console.log("════════════════════════════════════════\n");
    console.log("Tables created:");
    console.log("  ✅ customer_support_tickets");
    console.log("  ✅ customer_support_replies");
    console.log("  ✅ maid_support_tickets");
    console.log("  ✅ maid_support_replies");
    console.log("  ✅ support_ticket_attachments\n");
    console.log("Indexes created:");
    console.log("  ✅ All customer support indexes");
    console.log("  ✅ All maid support indexes");
    console.log("  ✅ All attachment indexes\n");

    process.exit(0);
  } catch (err) {
    console.error("❌ Error during database seeding:", err);
    process.exit(1);
  }
}

seedDatabase();
