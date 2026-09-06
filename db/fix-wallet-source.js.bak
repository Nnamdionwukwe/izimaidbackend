// db/fix-wallet-source.js
import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    "postgresql://postgres:lFTWaNFqrAsULGNgOuwhZkrdjAIlHIMq@centerbeam.proxy.rlwy.net:46630/railway",
  ssl: false,
});

async function run() {
  const client = await pool.connect();
  try {
    // See all columns on wallet_transactions
    const { rows: cols } = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'wallet_transactions'
      ORDER BY ordinal_position
    `);
    console.log("wallet_transactions columns:");
    cols.forEach((c) =>
      console.log(
        `  ${c.column_name} | ${c.data_type} | nullable: ${c.is_nullable} | default: ${c.column_default}`,
      ),
    );

    await client.query("BEGIN");

    // Make source nullable and give it a default so inserts don't break
    await client.query(
      `ALTER TABLE wallet_transactions ALTER COLUMN source DROP NOT NULL`,
    );
    await client.query(
      `ALTER TABLE wallet_transactions ALTER COLUMN source SET DEFAULT 'booking'`,
    );
    console.log(
      "\n✅ source column: NOT NULL dropped, default set to 'booking'",
    );

    await client.query("COMMIT");
    console.log("✅ Done — re-run the setup script now");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("❌", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
