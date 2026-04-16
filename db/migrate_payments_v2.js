// db/migrate_payments_v2.js
import pg from "pg";
const pool = new pg.Pool({
  connectionString:
    "postgresql://postgres:lFTWaNFqrAsULGNgOuwhZkrdjAIlHIMq@centerbeam.proxy.rlwy.net:46630/railway",
  ssl: false,
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Payments: bank transfer + crypto fields ───────────────────
    await client.query(`
      ALTER TABLE payments
        ADD COLUMN IF NOT EXISTS bank_transfer_ref     text,
        ADD COLUMN IF NOT EXISTS bank_transfer_proof   text,
        ADD COLUMN IF NOT EXISTS bank_transfer_status  text DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS crypto_charge_id      text,
        ADD COLUMN IF NOT EXISTS crypto_charge_code    text,
        ADD COLUMN IF NOT EXISTS crypto_currency       text,
        ADD COLUMN IF NOT EXISTS crypto_amount         numeric,
        ADD COLUMN IF NOT EXISTS crypto_address        text,
        ADD COLUMN IF NOT EXISTS crypto_expires_at     timestamptz,
        ADD COLUMN IF NOT EXISTS notes                 text
    `);
    console.log("✓ payments: bank transfer + crypto fields added");

    // ── Maid payouts table ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS maid_payouts (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        maid_id         uuid NOT NULL REFERENCES users(id),
        booking_id      uuid NOT NULL REFERENCES bookings(id),
        payment_id      uuid NOT NULL REFERENCES payments(id),
        amount          numeric NOT NULL,
        currency        text NOT NULL DEFAULT 'NGN',
        status          text NOT NULL DEFAULT 'pending',
        gateway         text NOT NULL DEFAULT 'manual',
        payout_ref      text,
        bank_name       text,
        account_number  text,
        account_name    text,
        stripe_transfer_id text,
        notes           text,
        processed_by    uuid REFERENCES users(id),
        processed_at    timestamptz,
        created_at      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_maid_payouts_maid 
      ON maid_payouts(maid_id, status);
      CREATE INDEX IF NOT EXISTS idx_maid_payouts_booking 
      ON maid_payouts(booking_id)
    `);
    console.log("✓ maid_payouts: table created");

    // ── Maid bank details (for payouts) ──────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS maid_bank_details (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        maid_id        uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        bank_name      text NOT NULL,
        account_number text NOT NULL,
        account_name   text NOT NULL,
        bank_code      text,
        country        text NOT NULL DEFAULT 'NG',
        currency       text NOT NULL DEFAULT 'NGN',
        stripe_account_id text,
        verified       boolean NOT NULL DEFAULT false,
        created_at     timestamptz NOT NULL DEFAULT now(),
        updated_at     timestamptz NOT NULL DEFAULT now()
      )
    `);
    console.log("✓ maid_bank_details: table created");

    await client.query("COMMIT");
    console.log("\n✅ Payments v2 migrations complete");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("✗ Failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
run().catch(console.error);
