// db/checkVerificationState.js
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

console.log(`\n🔍 Checking verification state for user_id = ${userId}\n`);

const client = await pool.connect();

try {
  console.log("1️⃣ Fetching all maid_documents for this user...\n");

  const { rows: docs } = await client.query(
    `SELECT id, doc_type, status, submitted_at, reviewed_at
     FROM maid_documents
     WHERE maid_id::text ILIKE $1::text
     ORDER BY submitted_at ASC`,
    [userId],
  );

  if (!docs.length) {
    console.log("❌ No documents found for this maid.\n");
  } else {
    docs.forEach((d) => {
      console.log(`📄 Document ${d.id}`);
      console.log(`   Type: ${d.doc_type}`);
      console.log(`   Status: ${d.status}`);
      console.log(`   Submitted: ${d.submitted_at}`);
      console.log(`   Reviewed: ${d.reviewed_at}`);
      console.log();
    });
  }

  console.log("\n2️⃣ Fetching maid_profiles.id_verified...\n");

  const { rows: profile } = await client.query(
    `SELECT id_verified, updated_at
     FROM maid_profiles
     WHERE user_id::text ILIKE $1::text`,
    [userId],
  );

  if (!profile.length) {
    console.log("❌ No maid_profiles row found.\n");
  } else {
    console.log("🟦 Database shows id_verified:", profile[0].id_verified);
    console.log("🕒 Profile updated_at:", profile[0].updated_at);
  }

  console.log("\n3️⃣ Computing what id_verified SHOULD be...\n");

  if (docs.length) {
    const latestReviewed = docs
      .filter((d) => d.reviewed_at)
      .sort((a, b) => new Date(b.reviewed_at) - new Date(a.reviewed_at))[0];

    if (!latestReviewed) {
      console.log("⚠️ Latest reviewed: NONE (all pending)");
    } else {
      console.log("Latest reviewed document:");
      console.log(`   id: ${latestReviewed.id}`);
      console.log(`   status: ${latestReviewed.status}`);
      console.log(`   reviewed_at: ${latestReviewed.reviewed_at}`);

      console.log(
        "\n⭐️ Based on documents, correct id_verified SHOULD BE:",
        latestReviewed.status === "approved" ? "true" : "false",
      );
    }
  }
} catch (err) {
  console.error("\n❌ Error:", err.message);
} finally {
  client.release();
  await pool.end();
  console.log("\nDone.\n");
}
