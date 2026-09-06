// db/listMaidDocuments.js
import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    "postgresql://postgres:lFTWaNFqrAsULGNgOuwhZkrdjAIlHIMq@centerbeam.proxy.rlwy.net:46630/railway",
  ssl: false,
});

const maidId = process.argv[2];

if (!maidId) {
  console.error("Please provide a maid_id (user_id) as an argument.");
  process.exit(1);
}

console.log(`\n🔍 Listing documents for maid_id = ${maidId}...\n`);

const client = await pool.connect();

try {
  const { rows } = await client.query(
    `SELECT id, doc_type, status, doc_url, submitted_at, reviewed_at 
     FROM maid_documents 
     WHERE maid_id = $1
     ORDER BY submitted_at DESC`,
    [maidId],
  );

  if (rows.length === 0) {
    console.log("⚠️ No documents found for this maid.\n");
  } else {
    rows.forEach((doc) => {
      console.log(`📄 Document ID: ${doc.id}`);
      console.log(`   Type: ${doc.doc_type}`);
      console.log(`   Status: ${doc.status}`);
      console.log(`   Submitted: ${doc.submitted_at}`);
      console.log(`   Reviewed: ${doc.reviewed_at}`);
      console.log();
    });
  }
} catch (err) {
  console.error("❌ Error:", err.message);
} finally {
  client.release();
  await pool.end();
  console.log("Done.\n");
}
