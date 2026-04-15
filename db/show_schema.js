// scripts/show_schema.js
import pg from "pg";
const pool = new pg.Pool({
  connectionString:
    "postgresql://postgres:lFTWaNFqrAsULGNgOuwhZkrdjAIlHIMq@centerbeam.proxy.rlwy.net:46630/railway",
  ssl: false,
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
  } finally {
    client.release();
    await pool.end();
  }
}
run().catch(console.error);
