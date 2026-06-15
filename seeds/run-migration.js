// run-migration.js
import pg from "pg";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  console.log("📦 Running database migration...");

  const client = await db.connect();

  try {
    // Read the migration file
    const migrationPath = path.join(
      __dirname,
      "migrations",
      "001_create_cleaner_applications_table.sql",
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    // Split SQL statements (handle multiple statements separated by semicolons)
    const statements = sql.split(";").filter((stmt) => stmt.trim().length > 0);

    await client.query("BEGIN");

    for (const statement of statements) {
      if (statement.trim()) {
        console.log(`Executing: ${statement.substring(0, 60)}...`);
        await client.query(statement);
      }
    }

    await client.query("COMMIT");
    console.log("✅ Migration completed successfully!");

    // Verify table was created
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'cleaner_applications'
      );
    `);

    if (rows[0].exists) {
      console.log("✓ cleaner_applications table exists");
    } else {
      console.log("✗ cleaner_applications table was not created");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

runMigration().catch(console.error);
