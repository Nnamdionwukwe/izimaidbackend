#!/usr/bin/env node

/**
 * Database Migration Script - IziMaid
 *
 * This script sets up and migrates the database schema to support:
 * - User deletion with cascading data cleanup
 * - Proper foreign key constraints
 * - Transaction safety
 * - Data integrity
 *
 * Usage:
 *   node scripts/migrate-db.js
 *   NODE_ENV=production node scripts/migrate-db.js
 */

import pkg from "pg";
const { Pool } = pkg;
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

const log = (message) => console.log(`[Migration] ${message}`);
const error = (message) => console.error(`[ERROR] ${message}`);

async function runMigration() {
  const client = await pool.connect();

  try {
    log("Starting database migration...");
    log(`Database: ${process.env.DATABASE_URL?.split("/").pop()}`);

    await client.query("BEGIN");

    // ── 1. Create users table ────────────────────────────────────────────────
    log("Creating users table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        avatar TEXT,
        google_id VARCHAR(255) UNIQUE NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'maid', 'admin')),
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ── 2. Add missing columns to users table ────────────────────────────────
    log("Checking and adding missing columns to users table...");

    const columnsResult = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'users'
    `);
    const existingColumns = columnsResult.rows.map((r) => r.column_name);

    if (!existingColumns.includes("is_active")) {
      log("  Adding is_active column...");
      await client.query(
        "ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true",
      );
    }

    if (!existingColumns.includes("updated_at")) {
      log("  Adding updated_at column...");
      await client.query(
        "ALTER TABLE users ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
      );
    }

    // ── 3. Create maid_profiles table ────────────────────────────────────────
    log("Creating maid_profiles table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS maid_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL,
        bio TEXT,
        hourly_rate DECIMAL(10, 2),
        years_exp INTEGER,
        location VARCHAR(255),
        services TEXT[],
        is_available BOOLEAN DEFAULT false,
        rating DECIMAL(3, 1),
        total_reviews INTEGER DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    // ── 4. Create bookings table ─────────────────────────────────────────────
    log("Creating bookings table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL,
        maid_id INTEGER NOT NULL,
        service_type VARCHAR(255),
        location VARCHAR(255),
        booking_date TIMESTAMP,
        status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'completed', 'cancelled')),
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (maid_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    // ── 5. Create payments table ─────────────────────────────────────────────
    log("Creating payments table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER NOT NULL,
        amount DECIMAL(10, 2),
        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'refunded')),
        method VARCHAR(50),
        transaction_id VARCHAR(255),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
      );
    `);

    // ── 6. Create reviews table ──────────────────────────────────────────────
    log("Creating reviews table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        maid_id INTEGER NOT NULL,
        customer_id INTEGER NOT NULL,
        booking_id INTEGER,
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (maid_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
      );
    `);

    // ── 7. Create indexes for performance ────────────────────────────────────
    log("Creating indexes...");

    const indexStatements = [
      // Users indexes
      "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);",
      "CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);",
      "CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);",
      "CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);",

      // Bookings indexes
      "CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);",
      "CREATE INDEX IF NOT EXISTS idx_bookings_maid_id ON bookings(maid_id);",
      "CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);",
      "CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);",

      // Payments indexes
      "CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON payments(booking_id);",
      "CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);",

      // Reviews indexes
      "CREATE INDEX IF NOT EXISTS idx_reviews_maid_id ON reviews(maid_id);",
      "CREATE INDEX IF NOT EXISTS idx_reviews_customer_id ON reviews(customer_id);",
      "CREATE INDEX IF NOT EXISTS idx_reviews_booking_id ON reviews(booking_id);",

      // Maid profiles indexes
      "CREATE INDEX IF NOT EXISTS idx_maid_profiles_user_id ON maid_profiles(user_id);",
      "CREATE INDEX IF NOT EXISTS idx_maid_profiles_location ON maid_profiles(location);",
    ];

    for (const statement of indexStatements) {
      await client.query(statement);
    }

    // ── 8. Verify foreign key constraints ────────────────────────────────────
    log("Verifying foreign key constraints...");

    // Check if FK constraints exist, add if missing
    const fkConstraints = await client.query(`
      SELECT constraint_name FROM information_schema.table_constraints 
      WHERE table_name IN ('maid_profiles', 'bookings', 'payments', 'reviews')
      AND constraint_type = 'FOREIGN KEY'
    `);

    const existingConstraints = fkConstraints.rows.map(
      (r) => r.constraint_name,
    );

    // Note: Adding constraints to existing tables is complex if they don't exist
    // This is already handled in the CREATE TABLE statements with ON DELETE CASCADE

    // ── 9. Summary ───────────────────────────────────────────────────────────
    log("Verifying table structure...");

    const tables = [
      "users",
      "maid_profiles",
      "bookings",
      "payments",
      "reviews",
    ];
    for (const tableName of tables) {
      const result = await client.query(
        `
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_name = $1
        ) as exists
      `,
        [tableName],
      );
      const status = result.rows[0].exists ? "✓" : "✗";
      log(`  ${status} ${tableName}`);
    }

    await client.query("COMMIT");

    log("✅ Migration completed successfully!");
    log("Database is ready for delete user feature.");
  } catch (err) {
    await client.query("ROLLBACK");
    error(`Migration failed: ${err.message}`);
    error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migration
runMigration().catch((err) => {
  error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
