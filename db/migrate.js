#!/usr/bin/env node

/**
 * Database Fix Script - Add Missing UNIQUE Constraint
 *
 * This script fixes the error:
 * "there is no unique or exclusion constraint matching the ON CONFLICT specification"
 *
 * The ON CONFLICT (google_id) requires a UNIQUE constraint on google_id column
 *
 * Usage:
 *   node scripts/fix-db-constraint.js
 *   NODE_ENV=production node scripts/fix-db-constraint.js
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

const log = (message) => console.log(`[Fix] ${message}`);
const error = (message) => console.error(`[ERROR] ${message}`);

async function fixConstraints() {
  const client = await pool.connect();

  try {
    log("Starting database constraint fix...");
    log(`Database: ${process.env.DATABASE_URL?.split("/").pop()}`);

    // ── 1. Check if google_id constraint exists ────────────────────────────
    log("Checking for UNIQUE constraint on google_id...");
    const checkConstraint = await client.query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'users'
      AND constraint_type = 'UNIQUE'
      AND constraint_name LIKE '%google_id%'
    `);

    if (checkConstraint.rows.length > 0) {
      log(
        `✓ UNIQUE constraint already exists: ${checkConstraint.rows[0].constraint_name}`,
      );
      return;
    }

    log("✗ No UNIQUE constraint found on google_id");

    // ── 2. Check if there's a non-unique constraint or index ────────────────
    log("Checking for existing indexes...");
    const checkIndex = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'users'
      AND indexname LIKE '%google_id%'
    `);

    if (checkIndex.rows.length > 0) {
      log(`Found index: ${checkIndex.rows[0].indexname}`);
      log("Dropping non-unique index before creating constraint...");
      await client.query(
        `DROP INDEX IF EXISTS ${checkIndex.rows[0].indexname} CASCADE`,
      );
    }

    // ── 3. Add UNIQUE constraint ────────────────────────────────────────────
    log("Adding UNIQUE constraint to google_id...");
    await client.query(
      `ALTER TABLE users ADD CONSTRAINT users_google_id_key UNIQUE (google_id)`,
    );
    log("✓ UNIQUE constraint added successfully");

    // ── 4. Verify constraint exists ─────────────────────────────────────────
    log("Verifying constraint...");
    const verify = await client.query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'users'
      AND constraint_type = 'UNIQUE'
      AND constraint_name = 'users_google_id_key'
    `);

    if (verify.rows.length > 0) {
      log("✓ Constraint verified successfully");
    } else {
      throw new Error("Constraint verification failed");
    }

    // ── 5. Also add email UNIQUE constraint if missing ─────────────────────
    log("Checking email UNIQUE constraint...");
    const emailConstraint = await client.query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'users'
      AND constraint_type = 'UNIQUE'
      AND constraint_name LIKE '%email%'
    `);

    if (emailConstraint.rows.length === 0) {
      log("Adding UNIQUE constraint to email...");
      await client.query(
        `ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email)`,
      );
      log("✓ Email UNIQUE constraint added");
    } else {
      log(
        `✓ Email constraint exists: ${emailConstraint.rows[0].constraint_name}`,
      );
    }

    // ── 6. Check maid_profiles constraint ───────────────────────────────────
    log("Checking maid_profiles UNIQUE constraint on user_id...");
    const maidConstraint = await client.query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'maid_profiles'
      AND constraint_type = 'UNIQUE'
      AND constraint_name LIKE '%user_id%'
    `);

    if (maidConstraint.rows.length === 0) {
      log("Adding UNIQUE constraint to maid_profiles.user_id...");
      await client.query(
        `ALTER TABLE maid_profiles ADD CONSTRAINT maid_profiles_user_id_key UNIQUE (user_id)`,
      );
      log("✓ Maid profiles UNIQUE constraint added");
    } else {
      log(
        `✓ Maid constraint exists: ${maidConstraint.rows[0].constraint_name}`,
      );
    }

    log("✅ All database constraints fixed successfully!");
  } catch (err) {
    error(`Fix failed: ${err.message}`);
    if (err.message.includes("already exists")) {
      log("(Constraint already exists - this is fine!)");
    } else {
      error(err);
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

fixConstraints().catch((err) => {
  error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
