import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// ── Load .env from the project root ──────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("connect", () => console.log("✓ Postgres connected"));
pool.on("error", (err) => console.error("✗ Postgres client error:", err));

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log("⏳ Checking for missing columns in bookings table…");

    // ── Log which database we're connected to ────────────────────
    const { rows: dbRows } = await client.query("SELECT current_database()");
    console.log(`📌 Connected to database: ${dbRows[0].current_database}`);

    // ── rate_type ─────────────────────────────────────────────────
    const { rows: rateCheck } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'bookings' AND column_name = 'rate_type'
    `);

    if (rateCheck.length === 0) {
      console.log("➕ Adding column: rate_type (TEXT DEFAULT 'hourly')");
      await client.query(`
        ALTER TABLE bookings
        ADD COLUMN rate_type TEXT DEFAULT 'hourly'
      `);
    } else {
      console.log("✓ rate_type already exists");
    }

    // ── duration_qty ──────────────────────────────────────────────
    const { rows: qtyCheck } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'bookings' AND column_name = 'duration_qty'
    `);

    if (qtyCheck.length === 0) {
      console.log("➕ Adding column: duration_qty (NUMERIC DEFAULT 1)");
      await client.query(`
        ALTER TABLE bookings
        ADD COLUMN duration_qty NUMERIC DEFAULT 1
      `);
    } else {
      console.log("✓ duration_qty already exists");
    }

    // ── Set defaults for NULL rows (safe) ────────────────────────
    await client.query(`
      UPDATE bookings SET rate_type = 'hourly' WHERE rate_type IS NULL
    `);
    await client.query(`
      UPDATE bookings SET duration_qty = 1 WHERE duration_qty IS NULL
    `);

    console.log("✅ Migration complete – bookings table updated.");
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
