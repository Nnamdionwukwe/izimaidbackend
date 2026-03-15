import pg from "pg";
import { readdir } from "fs/promises";
import { pathToFileURL } from "url";
import path from "path";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

async function migrate() {
  const client = await pool.connect();

  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id          SERIAL PRIMARY KEY,
        name        TEXT UNIQUE NOT NULL,
        ran_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Get already-ran migrations
    const { rows: ran } = await client.query(
      `SELECT name FROM _migrations ORDER BY name`,
    );
    const ranNames = new Set(ran.map((r) => r.name));

    // Load migration files in order
    const migrationsDir = path.join(process.cwd(), "db", "migrations");
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".js"))
      .sort();

    let count = 0;
    for (const file of files) {
      if (ranNames.has(file)) {
        console.log(`  — skipping ${file} (already ran)`);
        continue;
      }

      console.log(`  ↑ running ${file}`);
      const filePath = pathToFileURL(path.join(migrationsDir, file)).href;
      const migration = await import(filePath);

      await client.query("BEGIN");
      try {
        await migration.up(client);
        await client.query(`INSERT INTO _migrations (name) VALUES ($1)`, [
          file,
        ]);
        await client.query("COMMIT");
        console.log(`  ✓ ${file} done`);
        count++;
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`  ✗ ${file} failed:`, err.message);
        process.exit(1);
      }
    }

    if (count === 0) {
      console.log("\n✓ already up to date");
    } else {
      console.log(`\n✓ ran ${count} migration(s) successfully`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
