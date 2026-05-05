// Inspect the structure of the 'subscriptions' table
// Run: node db/inspect-subscriptions-table.js

import { config } from "dotenv";
config();

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const masked = process.env.DATABASE_URL?.replace(/:([^:@]{4,})@/, ":****@");
console.log("→ Connecting to:", masked);

async function inspect() {
  const client = await pool.connect();
  console.log("✓ Connected to database\n");

  try {
    console.log("🔍 Columns and types in 'subscriptions':");
    const columns = await client.query(`
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = 'subscriptions'
      ORDER BY ordinal_position;
    `);

    columns.rows.forEach((col) =>
      console.log(
        `• ${col.column_name} — ${col.data_type} ${col.is_nullable === "NO" ? "NOT NULL" : ""} ${col.column_default || ""}`,
      ),
    );

    console.log("\n🔍 Constraints:");
    const constraints = await client.query(`
      SELECT conname, contype
      FROM pg_constraint
      WHERE conrelid = 'subscriptions'::regclass
      ORDER BY conname;
    `);
    constraints.rows.forEach((c) =>
      console.log(`• ${c.conname} (${c.contype})`),
    );

    console.log("\n🔍 Indexes:");
    const indexes = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'subscriptions';
    `);
    indexes.rows.forEach((i) => console.log(`• ${i.indexname}: ${i.indexdef}`));

    console.log("\n✅ Inspection complete.");
  } catch (err) {
    console.error("❌ Error inspecting table:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

inspect();
