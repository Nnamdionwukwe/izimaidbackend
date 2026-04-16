// db/migrate_withdrawals.js
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

    // ── Maid wallet balance ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS maid_wallets (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        maid_id         uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        available       numeric NOT NULL DEFAULT 0,
        pending         numeric NOT NULL DEFAULT 0,
        total_earned    numeric NOT NULL DEFAULT 0,
        total_withdrawn numeric NOT NULL DEFAULT 0,
        currency        text    NOT NULL DEFAULT 'NGN',
        updated_at      timestamptz NOT NULL DEFAULT now()
      )
    `);
    console.log("✓ maid_wallets: table created");

    // ── Withdrawal requests ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        maid_id         uuid NOT NULL REFERENCES users(id),
        amount          numeric NOT NULL,
        currency        text    NOT NULL DEFAULT 'NGN',
        method          text    NOT NULL,
        status          text    NOT NULL DEFAULT 'pending',

        -- Bank transfer (local)
        bank_name       text,
        account_number  text,
        account_name    text,
        bank_code       text,
        bank_country    text,

        -- Wire transfer (SWIFT international)
        swift_code      text,
        iban            text,
        bank_address    text,

        -- Mobile money
        mobile_provider text,
        mobile_number   text,
        mobile_country  text,

        -- Crypto
        crypto_currency text,
        crypto_address  text,
        crypto_network  text,

        -- PayPal
        paypal_email    text,

        -- Wise
        wise_email      text,
        wise_account_id text,

        -- Flutterwave
        flw_reference   text,

        -- Processing
        fee             numeric NOT NULL DEFAULT 0,
        net_amount      numeric NOT NULL DEFAULT 0,
        gateway_ref     text,
        gateway_response jsonb,
        notes           text,
        failure_reason  text,

        -- Admin
        reviewed_by     uuid REFERENCES users(id),
        reviewed_at     timestamptz,

        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_withdrawals_maid    ON withdrawals(maid_id, status);
      CREATE INDEX IF NOT EXISTS idx_withdrawals_status  ON withdrawals(status, created_at DESC);
    `);
    console.log("✓ withdrawals: table created");

    // ── Wallet transactions (audit log) ──────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        maid_id     uuid NOT NULL REFERENCES users(id),
        type        text NOT NULL,  -- 'credit','debit','fee','reversal'
        amount      numeric NOT NULL,
        currency    text NOT NULL DEFAULT 'NGN',
        source      text NOT NULL,  -- 'booking_payout','withdrawal','refund'
        source_id   uuid,           -- booking_id or withdrawal_id
        balance_before numeric NOT NULL DEFAULT 0,
        balance_after  numeric NOT NULL DEFAULT 0,
        description text,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wallet_tx_maid 
      ON wallet_transactions(maid_id, created_at DESC)
    `);
    console.log("✓ wallet_transactions: table created");

    await client.query("COMMIT");
    console.log("\n✅ Withdrawals migration complete");
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
