// db/add-inquiry-conversations.js
import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    "postgresql://postgres:lFTWaNFqrAsULGNgOuwhZkrdjAIlHIMq@centerbeam.proxy.rlwy.net:46630/railway",
  ssl: false,
});

const client = await pool.connect();
try {
  // Make booking_id nullable
  await client.query(`
    ALTER TABLE conversations ALTER COLUMN booking_id DROP NOT NULL
  `);

  // Add type + maid_id for direct lookup
  await client.query(`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'booking'
  `);
  await client.query(`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS maid_id_direct UUID REFERENCES users(id)
  `);

  // Unique constraint so one inquiry per customer-maid pair
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_inquiry_unique
      ON conversations(customer_id, maid_id)
      WHERE type = 'inquiry' AND booking_id IS NULL
  `);

  console.log("✅ Done — conversations supports inquiries now");
} finally {
  client.release();
  await pool.end();
}
