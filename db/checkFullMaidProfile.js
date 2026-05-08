// db/checkFullMaidProfile.js
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

console.log(
  `\n🔍 Fetching FULL maid_profiles row for user_id = ${userId}...\n`,
);

const client = await pool.connect();

try {
  const { rows } = await client.query(
    `SELECT *
     FROM maid_profiles
     WHERE user_id::text ILIKE $1::text`,
    [userId],
  );

  if (!rows.length) {
    console.log("❌ No maid_profiles row found for that user_id.\n");
  } else {
    console.log("📄 FULL maid_profiles row:\n");
    console.log(rows[0]);
    console.log("\nKEY FIELDS:");
    console.log("user_id:", rows[0].user_id);
    console.log("id_verified:", rows[0].id_verified);
    console.log("created_at:", rows[0].created_at);
    console.log("updated_at:", rows[0].updated_at);
  }
} catch (err) {
  console.error("❌ Error:", err.message);
} finally {
  client.release();
  await pool.end();
  console.log("\nDone.\n");
}
