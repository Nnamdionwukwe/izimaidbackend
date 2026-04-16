// db/migrate_docs_constraint.js
import pg from "pg";
const pool = new pg.Pool({
  connectionString:
    "postgresql://postgres:lFTWaNFqrAsULGNgOuwhZkrdjAIlHIMq@centerbeam.proxy.rlwy.net:46630/railway",
  ssl: false,
});
async function run() {
  const client = await pool.connect();
  try {
    // Check if constraint already exists before adding
    const { rows } = await client.query(`
      SELECT 1 FROM pg_constraint 
      WHERE conname = 'maid_documents_maid_type_unique'
    `);

    if (rows.length === 0) {
      await client.query(`
        ALTER TABLE maid_documents
          ADD CONSTRAINT maid_documents_maid_type_unique
          UNIQUE (maid_id, doc_type)
      `);
      console.log("✓ maid_documents: unique constraint added");
    } else {
      console.log(
        "✓ maid_documents: unique constraint already exists, skipping",
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
}
run().catch(console.error);
