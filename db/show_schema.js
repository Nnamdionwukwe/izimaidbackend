// db/show_schema.js - Fixed
import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function run() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT 
        t.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default
      FROM information_schema.tables t
      JOIN information_schema.columns c ON c.table_name = t.table_name
      WHERE t.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name, c.ordinal_position
    `);

    let current = "";
    for (const row of rows) {
      if (row.table_name !== current) {
        current = row.table_name;
        console.log(`\n── ${current.toUpperCase()} ──`);
      }
      console.log(
        `  ${row.column_name} (${row.data_type}) ${row.is_nullable === "NO" ? "NOT NULL" : ""} ${row.column_default ? `DEFAULT ${row.column_default}` : ""}`,
      );
    }
    console.log(`\n✅ Total tables: ${rows.length ? new Set(rows.map(r => r.table_name)).size : 0}`);
  } finally {
    client.release();
    await pool.end();
  }
}
run().catch(console.error);
