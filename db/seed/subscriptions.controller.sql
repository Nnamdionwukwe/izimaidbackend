-- db/seed/subscriptions.controller.sql
-- Matches: src/controllers/subscriptions.controller.js
-- Creates: subscription_plans, subscription_invoices, promo_codes
-- Extends: subscriptions (full schema), payments (flutterwave columns)
-- Verified against live DB column-by-column.

-- ══════════════════════════════════════════════════════════════════════
--  subscriptions — extend the minimal version from auth.sql
-- ══════════════════════════════════════════════════════════════════════

-- ── Core subscription fields ────────────────────────────────────────
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS currency                  TEXT NOT NULL DEFAULT 'NGN';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS amount                    NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS interval                  TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_start      TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_end        TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancellation_reason       TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paused_at                 TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS resumed_at                TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_start               TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_end                 TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS discount_percent          NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS auto_renew                BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS bookings_used             INTEGER NOT NULL DEFAULT 0;

-- ── Flutterwave (current gateway) ───────────────────────────────────
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS gateway                   TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS flutterwave_tx_ref        TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS flutterwave_transaction_id TEXT;

-- ── Legacy gateways (present in live; harmless to keep for parity) ──
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paystack_email_token      TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paystack_sub_code         TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id        TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_sub_id             TEXT;

-- ── Promo ────────────────────────────────────────────────────────────
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS promo_code                TEXT;

-- Verify status enum covers all code paths
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active','trialing','past_due','paused','cancelled','expired'));

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end  ON subscriptions (current_period_end)
  WHERE status IN ('active','trialing');
CREATE INDEX IF NOT EXISTS idx_subscriptions_currency    ON subscriptions (currency);

-- ══════════════════════════════════════════════════════════════════════
--  subscription_plans — plan definitions (reference data)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS subscription_plans (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identifier used in code: plan.name === 'free', 'pro_badge'
  name                 TEXT NOT NULL UNIQUE,
  display_name         TEXT NOT NULL,
  description          TEXT,

  -- Who this plan is for
  target_role          TEXT NOT NULL DEFAULT 'customer'
                         CHECK (target_role IN ('customer','maid','both')),

  plan_type            TEXT NOT NULL DEFAULT 'recurring'
                         CHECK (plan_type IN ('recurring','one_time','free')),
  interval             TEXT NOT NULL DEFAULT 'monthly'
                         CHECK (interval IN ('monthly','quarterly','annual')),

  -- Multi-currency prices: {"NGN": 5000, "USD": 5, "GBP": 4}
  prices               JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Feature list: ["Unlimited bookings", "Priority support"]
  features             JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Legacy gateway codes (present in live; kept for parity)
  paystack_plan_codes  JSONB NOT NULL DEFAULT '{}'::jsonb,
  stripe_price_ids     JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Limits / benefits
  bookings_per_month   INTEGER,           -- NULL = unlimited
  discount_percent     NUMERIC(5,2) NOT NULL DEFAULT 0,
  priority_matching    BOOLEAN NOT NULL DEFAULT false,
  dedicated_support    BOOLEAN NOT NULL DEFAULT false,
  badge                TEXT,              -- e.g. 'pro' → set on users.subscription_badge

  -- Trial
  trial_days           INTEGER NOT NULL DEFAULT 0,

  -- Display
  is_active            BOOLEAN NOT NULL DEFAULT true,
  is_featured          BOOLEAN NOT NULL DEFAULT false,
  is_popular           BOOLEAN NOT NULL DEFAULT false,
  sort_order           INTEGER NOT NULL DEFAULT 0,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drift-repair: add columns to older DBs
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS paystack_plan_codes JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS stripe_price_ids    JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS is_popular          BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sub_plans_active ON subscription_plans (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_sub_plans_role   ON subscription_plans (target_role, sort_order);
CREATE INDEX IF NOT EXISTS idx_sub_plans_name   ON subscription_plans (name);

DROP TRIGGER IF EXISTS trg_sub_plans_updated_at ON subscription_plans;
CREATE TRIGGER trg_sub_plans_updated_at
  BEFORE UPDATE ON subscription_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  subscription_invoices — one per billing period per subscription
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS subscription_invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id   UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  amount            NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'NGN',
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','paid','failed','refunded','void')),
  failure_reason    TEXT,

  gateway           TEXT,
  gateway_ref       TEXT,

  period_start      TIMESTAMPTZ,
  period_end        TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drift-repair
ALTER TABLE subscription_invoices ADD COLUMN IF NOT EXISTS failure_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_sub_invoices_sub     ON subscription_invoices (subscription_id);
CREATE INDEX IF NOT EXISTS idx_sub_invoices_user    ON subscription_invoices (user_id);
CREATE INDEX IF NOT EXISTS idx_sub_invoices_status  ON subscription_invoices (status);
CREATE INDEX IF NOT EXISTS idx_sub_invoices_created ON subscription_invoices (created_at DESC);

DROP TRIGGER IF EXISTS trg_sub_invoices_updated_at ON subscription_invoices;
CREATE TRIGGER trg_sub_invoices_updated_at
  BEFORE UPDATE ON subscription_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  promo_codes — discount codes for subscriptions
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS promo_codes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  code              TEXT NOT NULL UNIQUE,
  description       TEXT,

  discount_type     TEXT NOT NULL DEFAULT 'percent'
                      CHECK (discount_type IN ('percent','fixed')),
  discount_value    NUMERIC(12,2) NOT NULL,

  -- NULL = any currency; otherwise specific currency only
  currency          TEXT,

  max_uses          INTEGER,             -- NULL = unlimited
  uses_count        INTEGER NOT NULL DEFAULT 0,

  min_plan          TEXT,                -- optional plan-name gate

  valid_from        TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until       TIMESTAMPTZ,         -- NULL = no expiry

  is_active         BOOLEAN NOT NULL DEFAULT true,

  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drift-repair: live DB has promo_codes but may lack updated_at
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_promo_codes_code    ON promo_codes (code);
CREATE INDEX IF NOT EXISTS idx_promo_codes_active  ON promo_codes (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_promo_codes_valid   ON promo_codes (valid_from, valid_until);

DROP TRIGGER IF EXISTS trg_promo_codes_updated_at ON promo_codes;
CREATE TRIGGER trg_promo_codes_updated_at
  BEFORE UPDATE ON promo_codes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  payments — extend with Flutterwave columns (used by subscription flow)
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE payments ADD COLUMN IF NOT EXISTS flutterwave_tx_ref      TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS flutterwave_payment_id  TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_flw_tx_ref     ON payments (flutterwave_tx_ref)
  WHERE flutterwave_tx_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_flw_payment_id ON payments (flutterwave_payment_id)
  WHERE flutterwave_payment_id IS NOT NULL;