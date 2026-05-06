#!/usr/bin/env node
// ─── Migration: Add video call columns to bookings table ─────────────
// Usage: node add-video-call-columns.js

import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

async function migrate() {
  const client = await pool.connect();
  console.log("✅ Connected to database");

  try {
    await client.query("BEGIN");

    // ── 1. Add video_call_status ───────────────────────────────────
    await client.query(`
      ALTER TABLE bookings
        ADD COLUMN IF NOT EXISTS video_call_status VARCHAR(20) DEFAULT 'idle'
    `);
    console.log("✅ video_call_status column added (or already exists)");

    // ── 2. Add video_call_started_at ──────────────────────────────
    await client.query(`
      ALTER TABLE bookings
        ADD COLUMN IF NOT EXISTS video_call_started_at TIMESTAMPTZ
    `);
    console.log("✅ video_call_started_at column added (or already exists)");

    // ── 3. Add video_call_room (in case it's missing too) ─────────
    await client.query(`
      ALTER TABLE bookings
        ADD COLUMN IF NOT EXISTS video_call_room VARCHAR(255)
    `);
    console.log("✅ video_call_room column added (or already exists)");

    // ── 4. Add video_call_token (legacy — keep for compatibility) ──
    await client.query(`
      ALTER TABLE bookings
        ADD COLUMN IF NOT EXISTS video_call_token VARCHAR(255)
    `);
    console.log("✅ video_call_token column added (or already exists)");

    // ── 5. Reset any stuck 'ringing' calls from previous runs ─────
    const { rowCount } = await client.query(`
      UPDATE bookings
        SET video_call_status = 'idle',
            video_call_room   = NULL
      WHERE video_call_status = 'ringing'
        AND (video_call_started_at IS NULL
          OR video_call_started_at < now() - interval '10 minutes')
    `);
    console.log(`✅ Reset ${rowCount} stuck ringing call(s)`);

    await client.query("COMMIT");
    console.log(
      "\n🎉 Migration complete — all video call columns are ready.\n",
    );

    // ── Verify ─────────────────────────────────────────────────────
    const { rows } = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'bookings'
        AND column_name LIKE 'video_call%'
      ORDER BY column_name
    `);

    console.log("── Current video_call columns on bookings ──");
    console.table(rows);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Migration failed — rolled back:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
