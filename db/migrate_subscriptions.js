// db/migrate_subscriptions.js
import pg from "pg";
const pool = new pg.Pool({
  connectionString: "postgresql://postgres:lFTWaNFqrAsULGNgOuwhZkrdjAIlHIMq@centerbeam.proxy.rlwy.net:46630/railway",
  ssl: false,
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Subscription plans ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name            text NOT NULL,          -- 'basic','standard','premium','pro_badge'
        display_name    text NOT NULL,          -- 'Basic','Standard','Premium','Verified Pro'
        description     text,
        target_role     text NOT NULL DEFAULT 'customer', -- 'customer','maid'
        plan_type       text NOT NULL DEFAULT 'recurring', -- 'recurring','one_time','annual'
        interval        text DEFAULT 'monthly', -- 'monthly','quarterly','annual'

        -- Pricing per currency (jsonb: { NGN: 2500, USD: 5, GBP: 4, EUR: 4.5, KES: 700 })
        prices          jsonb NOT NULL DEFAULT '{}',

        -- Features (jsonb array)
        features        jsonb NOT NULL DEFAULT '[]',

        -- Limits
        bookings_per_month  integer DEFAULT NULL,  -- NULL = unlimited
        discount_percent    integer DEFAULT 0,
        priority_matching   boolean NOT NULL DEFAULT false,
        dedicated_support   boolean NOT NULL DEFAULT false,
        badge               text    DEFAULT NULL,  -- 'basic','verified','premium'

        -- Trial
        trial_days      integer NOT NULL DEFAULT 0,

        -- Status
        is_active       boolean NOT NULL DEFAULT true,
        is_featured     boolean NOT NULL DEFAULT false,
        sort_order      integer NOT NULL DEFAULT 0,

        -- Stripe & Paystack plan IDs per currency
        stripe_price_ids   jsonb DEFAULT '{}',  -- { monthly: 'price_xxx', annual: 'price_yyy' }
        paystack_plan_codes jsonb DEFAULT '{}', -- { NGN: 'PLN_xxx' }

        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Seed plans
    await client.query(`
      INSERT INTO subscription_plans
        (name, display_name, description, target_role, plan_type, interval,
         prices, features, bookings_per_month, discount_percent,
         priority_matching, dedicated_support, badge, is_featured, sort_order)
      VALUES
        (
          'free', 'Free', 'Get started with basic access', 'customer',
          'recurring', 'monthly',
          '{"NGN":0,"USD":0,"GBP":0,"EUR":0,"KES":0,"GHS":0,"ZAR":0,"CAD":0,"AUD":0}',
          '["Book maids on demand","Standard matching","Email support"]',
          2, 0, false, false, null, false, 0
        ),
        (
          'basic', 'Basic', 'For occasional cleaning needs', 'customer',
          'recurring', 'monthly',
          '{"NGN":2500,"USD":5,"GBP":4,"EUR":4.5,"KES":700,"GHS":70,"ZAR":95,"CAD":7,"AUD":8}',
          '["1 booking/month included","5% discount on all bookings","Email support","Cancel anytime"]',
          1, 5, false, false, 'basic', false, 1
        ),
        (
          'standard', 'Standard', 'Our most popular plan', 'customer',
          'recurring', 'monthly',
          '{"NGN":6000,"USD":12,"GBP":10,"EUR":11,"KES":1600,"GHS":165,"ZAR":220,"CAD":16,"AUD":18}',
          '["3 bookings/month included","10% discount on all bookings","Priority matching","Chat support","Booking reminders"]',
          3, 10, true, false, 'standard', true, 2
        ),
        (
          'premium', 'Premium', 'For homes that need regular cleaning', 'customer',
          'recurring', 'monthly',
          '{"NGN":15000,"USD":30,"GBP":24,"EUR":27,"KES":4000,"GHS":410,"ZAR":550,"CAD":40,"AUD":45}',
          '["Unlimited bookings","15% discount on all bookings","Priority matching","Dedicated support","Same-day booking","Verified maids only","Monthly report"]',
          NULL, 15, true, true, 'premium', false, 3
        ),
        (
          'pro_badge', 'Verified Pro', 'Stand out and earn more', 'maid',
          'annual', 'annual',
          '{"NGN":5000,"USD":10,"GBP":8,"EUR":9,"KES":1400,"GHS":140,"ZAR":185,"CAD":14,"AUD":16}',
          '["Verified Pro badge on profile","Priority listing in search","Background check certificate","Trust badge on bookings","20% more booking visibility"]',
          NULL, 0, true, false, 'pro', false, 0
        )
      ON CONFLICT DO NOTHING
    `);
    console.log("✓ subscription_plans: seeded");

    // ── User subscriptions ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_id         uuid NOT NULL REFERENCES subscription_plans(id),
        status          text NOT NULL DEFAULT 'active',
        -- 'trialing','active','past_due','cancelled','expired','paused'

        currency        text NOT NULL DEFAULT 'NGN',
        amount          numeric NOT NULL DEFAULT 0,
        interval        text NOT NULL DEFAULT 'monthly',

        -- Billing dates
        current_period_start  timestamptz NOT NULL DEFAULT now(),
        current_period_end    timestamptz NOT NULL,
        trial_start           timestamptz,
        trial_end             timestamptz,
        cancelled_at          timestamptz,
        cancel_at_period_end  boolean NOT NULL DEFAULT false,
        cancellation_reason   text,
        paused_at             timestamptz,
        resumed_at            timestamptz,

        -- Gateway refs
        gateway              text DEFAULT 'manual', -- 'paystack','stripe','manual'
        paystack_sub_code    text,
        paystack_email_token text,
        stripe_sub_id        text,
        stripe_customer_id   text,

        -- Promo / discount
        promo_code           text,
        discount_percent     integer DEFAULT 0,

        -- Bookings usage this period
        bookings_used        integer NOT NULL DEFAULT 0,

        -- Auto-renew
        auto_renew           boolean NOT NULL DEFAULT true,

        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),

        -- One active subscription per user
        UNIQUE(user_id, status) DEFERRABLE INITIALLY DEFERRED
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_subs_user   ON subscriptions(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_subs_expiry ON subscriptions(current_period_end, status);
      CREATE INDEX IF NOT EXISTS idx_subs_gateway_paystack ON subscriptions(paystack_sub_code)
        WHERE paystack_sub_code IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_subs_gateway_stripe ON subscriptions(stripe_sub_id)
        WHERE stripe_sub_id IS NOT NULL;
    `);
    console.log("✓ subscriptions: table created");

    // ── Subscription invoices ─────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscription_invoices (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        user_id         uuid NOT NULL REFERENCES users(id),
        amount          numeric NOT NULL,
        currency        text NOT NULL DEFAULT 'NGN',
        status          text NOT NULL DEFAULT 'pending',
        -- 'pending','paid','failed','refunded','void'
        gateway         text,
        gateway_ref     text,
        period_start    timestamptz NOT NULL,
        period_end      timestamptz NOT NULL,
        paid_at         timestamptz,
        failure_reason  text,
        created_at      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sub_invoices_sub  ON subscription_invoices(subscription_id);
      CREATE INDEX IF NOT EXISTS idx_sub_invoices_user ON subscription_invoices(user_id, created_at DESC);
    `);
    console.log("✓ subscription_invoices: table created");

    // ── Promo codes ───────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code            text NOT NULL UNIQUE,
        description     text,
        discount_type   text NOT NULL DEFAULT 'percent', -- 'percent','fixed'
        discount_value  numeric NOT NULL,
        currency        text DEFAULT NULL, -- NULL = all currencies
        max_uses        integer DEFAULT NULL, -- NULL = unlimited
        uses_count      integer NOT NULL DEFAULT 0,
        min_plan        text DEFAULT NULL,  -- minimum plan required
        valid_from      timestamptz NOT NULL DEFAULT now(),
        valid_until     timestamptz DEFAULT NULL, -- NULL = no expiry
        is_active       boolean NOT NULL DEFAULT true,
        created_by      uuid REFERENCES users(id),
        created_at      timestamptz NOT NULL DEFAULT now()
      )
    `);
    console.log("✓ promo_codes: table created");

    // ── Add subscription fields to users ──────────────────────────
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS subscription_plan  text DEFAULT 'free',
        ADD COLUMN IF NOT EXISTS subscription_badge text DEFAULT NULL
    `);
    console.log("✓ users: subscription fields added");

    await client.query("COMMIT");
    console.log("\n✅ Subscriptions migration complete");
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