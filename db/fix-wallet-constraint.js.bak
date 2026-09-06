// db/fix-wallet-constraint.js
import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    "postgresql://postgres:lFTWaNFqrAsULGNgOuwhZkrdjAIlHIMq@centerbeam.proxy.rlwy.net:46630/railway",
  ssl: false,
});

const client = await pool.connect();
try {
  // Show current constraints
  const { rows } = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE conrelid = 'maid_wallets'::regclass
  `);
  console.log("Current constraints:", rows);

  // Add UNIQUE(maid_id, currency) if missing
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'maid_wallets_maid_id_currency_key'
      ) THEN
        ALTER TABLE maid_wallets
          ADD CONSTRAINT maid_wallets_maid_id_currency_key
          UNIQUE (maid_id, currency);
        RAISE NOTICE 'Constraint added';
      ELSE
        RAISE NOTICE 'Constraint already exists';
      END IF;
    END $$
  `);
  console.log("✅ Done");
} finally {
  client.release();
  await pool.end();
}
