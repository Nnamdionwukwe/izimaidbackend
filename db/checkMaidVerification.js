// db/checkMaidVerification.js
import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    "postgresql://postgres:lFTWaNFqrAsULGNgOuwhZkrdjAIlHIMq@centerbeam.proxy.rlwy.net:46630/railway",
  ssl: false,
});

const userId = process.argv[2];

if (!userId) {
  console.error("Please provide a user_id as an argument.");
  process.exit(1);
}

console.log(`\n🔍 Checking id_verified for user_id = ${userId}...\n`);

const client = await pool.connect();

try {
  // 1. Check if table exists
  const { rows: tableCheck } = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'maid_profiles'
    ) AS exists
  `);

  if (!tableCheck[0].exists) {
    console.log("❌ maid_profiles table does not exist!\n");
    process.exit(1);
  }

  // 2. Run query
  const { rows } = await client.query(
    `SELECT id_verified FROM maid_profiles WHERE user_id = $1`,
    [userId],
  );

  if (rows.length === 0) {
    console.log("⚠️ No maid found with that user_id.\n");
  } else {
    console.log(`✅ id_verified = ${rows[0].id_verified}\n`);
  }
} catch (err) {
  console.error("❌ Error:", err.message);
} finally {
  client.release();
  await pool.end();
  console.log("Done.\n");
}
