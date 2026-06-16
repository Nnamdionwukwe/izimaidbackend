// scripts/fix-reviewed-by-column.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function fixReviewedByColumn() {
  console.log("🔧 Fixing reviewed_by column types...");

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const tables = [
      "cleaner_applications",
      "housekeeper_applications",
      "caregiver_applications",
      "domestic_certification_applications",
    ];

    for (const table of tables) {
      console.log(`📝 Checking table: ${table}`);

      // Check if column exists
      const { rows } = await client.query(
        `
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = $1 AND column_name = 'reviewed_by'
      `,
        [table],
      );

      if (rows.length > 0) {
        console.log(`   Column reviewed_by exists in ${table}`);

        // Alter column type to TEXT if it's integer
        if (rows[0].data_type === "integer") {
          console.log(
            `   ⚠️  Changing reviewed_by from INTEGER to TEXT in ${table}`,
          );
          await client.query(`
            ALTER TABLE ${table} 
            ALTER COLUMN reviewed_by TYPE VARCHAR(255) USING reviewed_by::VARCHAR
          `);
          console.log(`   ✅ Updated ${table}`);
        } else {
          console.log(
            `   ✅ ${table} already has correct type: ${rows[0].data_type}`,
          );
        }
      } else {
        console.log(`   ⚠️  No reviewed_by column found in ${table}, skipping`);
      }
    }

    await client.query("COMMIT");
    console.log("✅ All tables updated successfully!");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error:", error);
  } finally {
    client.release();
    await db.end();
  }
}

fixReviewedByColumn().catch(console.error);
