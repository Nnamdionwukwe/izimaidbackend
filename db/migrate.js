#!/usr/bin/env node

/**
 * Database Migration - Fix: Add "declined" to booking_status ENUM
 *
 * The database has an ENUM type for booking status that doesn't include "declined"
 * This script:
 * 1. Creates a new ENUM type with all valid statuses including "declined"
 * 2. Changes the column to use the new ENUM
 * 3. Drops the old ENUM
 * 4. Adds declined_by and declined_reason columns if missing
 *
 * Usage:
 *   node scripts/fix-booking-enum.js
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

async function migrate() {
  const client = await pool.connect();

  try {
    log("Starting migration: Fix booking_status ENUM to include 'declined'...");

    await client.query("BEGIN");

    // ── 1. Check current enum values ────────────────────────────────────────
    log("Checking current booking_status enum values...");
    const enumCheck = await client.query(`
      SELECT enumlabel 
      FROM pg_enum 
      WHERE enumtypid = 'booking_status'::regtype
      ORDER BY enumsortorder
    `);

    const currentValues = enumCheck.rows.map((row) => row.enumlabel);
    log(`Current values: ${currentValues.join(", ")}`);

    // Check if "declined" already exists
    if (currentValues.includes("declined")) {
      log("✓ 'declined' status already exists in enum");
      // Still need to add columns
    } else {
      log("'declined' status not found - adding it...");

      // ── 2. Create new enum type with all values ────────────────────────────
      const newValues = [
        ...currentValues,
        "declined", // Add new value
      ];

      log(`Creating new enum with values: ${newValues.join(", ")}`);

      await client.query(`
        CREATE TYPE booking_status_new AS ENUM (
          ${newValues.map((v) => `'${v}'`).join(", ")}
        )
      `);

      // ── 3. Convert column to use new enum ──────────────────────────────────
      log("Updating bookings table to use new enum type...");

      await client.query(`
        ALTER TABLE bookings 
        ALTER COLUMN status 
        DROP DEFAULT
      `);

      await client.query(`
        ALTER TABLE bookings 
        ALTER COLUMN status 
        TYPE booking_status_new 
        USING status::text::booking_status_new
      `);

      await client.query(`
        ALTER TABLE bookings 
        ALTER COLUMN status 
        SET DEFAULT 'pending'::booking_status_new
      `);

      log("✓ Column type updated");

      // ── 4. Drop old enum ───────────────────────────────────────────────────
      log("Dropping old enum type...");

      await client.query(`
        DROP TYPE booking_status
      `);

      // ── 5. Rename new enum ────────────────────────────────────────────────
      log("Renaming new enum to booking_status...");

      await client.query(`
        ALTER TYPE booking_status_new RENAME TO booking_status
      `);

      log("✓ Enum updated successfully");
    }

    // ── 6. Add declined_by column ──────────────────────────────────────────
    log("Checking for declined_by column...");
    const declinedByCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'bookings' AND column_name = 'declined_by'
    `);

    if (declinedByCheck.rows.length === 0) {
      log("Adding declined_by column...");
      await client.query(`
        ALTER TABLE bookings 
        ADD COLUMN declined_by VARCHAR(50)
      `);
      log("✓ declined_by column added");
    } else {
      log("✓ declined_by column already exists");
    }

    // ── 7. Add declined_reason column ──────────────────────────────────────
    log("Checking for declined_reason column...");
    const declinedReasonCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'bookings' AND column_name = 'declined_reason'
    `);

    if (declinedReasonCheck.rows.length === 0) {
      log("Adding declined_reason column...");
      await client.query(`
        ALTER TABLE bookings 
        ADD COLUMN declined_reason TEXT
      `);
      log("✓ declined_reason column added");
    } else {
      log("✓ declined_reason column already exists");
    }

    // ── 8. Add index for declined bookings ──────────────────────────────────
    log("Checking for declined status index...");
    const indexCheck = await client.query(`
      SELECT indexname FROM pg_indexes 
      WHERE tablename = 'bookings' AND indexname = 'idx_bookings_declined'
    `);

    if (indexCheck.rows.length === 0) {
      log("Creating index for declined bookings...");
      await client.query(`
        CREATE INDEX idx_bookings_declined 
        ON bookings(status) 
        WHERE status = 'declined'
      `);
      log("✓ Index created");
    } else {
      log("✓ Index already exists");
    }

    await client.query("COMMIT");

    log("✅ Migration completed successfully!");
    log("Booking status enum now includes 'declined'");
    log("Bookings table now has declined_by and declined_reason columns");
  } catch (err) {
    await client.query("ROLLBACK");
    error(`Migration failed: ${err.message}`);
    error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
