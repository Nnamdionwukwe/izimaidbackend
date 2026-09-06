// db/checkMaidDocumentMaidId.js
import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    "postgresql://postgres:lFTWaNFqrAsULGNgOuwhZkrdjAIlHIMq@centerbeam.proxy.rlwy.net:46630/railway",
  ssl: false,
});

const docId = process.argv[2];

if (!docId) {
  console.error("Please provide a document id as an argument.");
  process.exit(1);
}

console.log(`\n🔍 Checking maid_id for document_id = ${docId}...\n`);

const client = await pool.connect();

try {
  const { rows } = await client.query(
    `SELECT maid_id FROM maid_documents WHERE id = $1`,
    [docId],
  );

  if (rows.length === 0) {
    console.log("⚠️ No document found with that id.\n");
  } else {
    console.log(`✅ maid_id = ${rows[0].maid_id}\n`);
  }
} catch (err) {
  console.error("❌ Error:", err.message);
} finally {
  client.release();
  await pool.end();
  console.log("Done.\n");
}
