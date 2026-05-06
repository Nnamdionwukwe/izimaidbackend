#!/usr/bin/env node
// ─── Migration: Agora video calls + Expo push notification tokens ─────
// Usage: node add-agora-push.js

import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

async function migrate() {
  const client = await pool.connect();
  console.log("✅ Connected to database\n");

  try {
    await client.query("BEGIN");

    // ── 1. push_tokens table ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS push_tokens (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token      TEXT NOT NULL,
        platform   VARCHAR(10),
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(user_id, token)
      )
    `);
    console.log("✅ push_tokens table ready");

    // ── 2. Agora / call columns on bookings ───────────────────────
    const cols = [
      ["video_call_status", "VARCHAR(20)  DEFAULT 'idle'"],
      ["video_call_started_at", "TIMESTAMPTZ"],
      ["video_call_room", "VARCHAR(255)"],
      ["video_call_token", "VARCHAR(255)"],
      ["video_call_channel", "VARCHAR(255)"],
    ];

    for (const [col, def] of cols) {
      await client.query(`
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ${col} ${def}
      `);
      console.log(`✅ bookings.${col} ready`);
    }

    // ── 3. Reset stale ringing calls ──────────────────────────────
    const { rowCount } = await client.query(`
      UPDATE bookings
        SET video_call_status = 'idle',
            video_call_room   = NULL,
            video_call_channel = NULL
      WHERE video_call_status = 'ringing'
        AND (video_call_started_at IS NULL
          OR video_call_started_at < now() - interval '10 minutes')
    `);
    console.log(`✅ Reset ${rowCount} stale ringing call(s)`);

    await client.query("COMMIT");
    console.log("\n🎉 Migration complete!\n");

    // ── Verify ────────────────────────────────────────────────────
    const { rows: bookingCols } = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'bookings' AND column_name LIKE 'video_call%'
      ORDER BY column_name
    `);
    console.log("── bookings video_call columns ──");
    console.table(bookingCols);

    const { rows: pushCols } = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'push_tokens'
      ORDER BY ordinal_position
    `);
    console.log("── push_tokens columns ──");
    console.table(pushCols);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Migration failed — rolled back:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
