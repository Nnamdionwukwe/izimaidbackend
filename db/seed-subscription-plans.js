// scripts/seed-subscription-plans.js
// Run: node --env-file=.env scripts/seed-subscription-plans.js

import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Plan definitions ──────────────────────────────────────────────────
const PLANS = [
  // ════════ CUSTOMER PLANS ════════

  {
    name: "free",
    display_name: "Free",
    description: "Get started with basic bookings",
    target_role: "customer",
    plan_type: "recurring",
    interval: "monthly",
    prices: { NGN: 0, USD: 0, GBP: 0, EUR: 0 },
    features: ["2 bookings per month", "Standard matching", "In-app chat"],
    bookings_per_month: 2,
    discount_percent: 0,
    priority_matching: false,
    dedicated_support: false,
    badge: null,
    trial_days: 0,
    is_featured: false,
    sort_order: 0,
  },

  {
    name: "basic_monthly",
    display_name: "Basic — Monthly",
    description: "More bookings, better matching",
    target_role: "customer",
    plan_type: "recurring",
    interval: "monthly",
    prices: { NGN: 2500, USD: 3, GBP: 2, EUR: 2 },
    features: [
      "10 bookings per month",
      "Priority maid matching",
      "In-app chat & video call",
      "5% booking discount",
    ],
    bookings_per_month: 10,
    discount_percent: 5,
    priority_matching: true,
    dedicated_support: false,
    badge: null,
    trial_days: 7,
    is_featured: false,
    sort_order: 1,
  },

  {
    name: "basic_annual",
    display_name: "Basic — Annual",
    description: "More bookings, better matching — save 20%",
    target_role: "customer",
    plan_type: "recurring",
    interval: "annual",
    prices: { NGN: 24000, USD: 29, GBP: 22, EUR: 25 },
    features: [
      "10 bookings per month",
      "Priority maid matching",
      "In-app chat & video call",
      "5% booking discount",
      "2 months free vs monthly",
    ],
    bookings_per_month: 10,
    discount_percent: 5,
    priority_matching: true,
    dedicated_support: false,
    badge: null,
    trial_days: 0,
    is_featured: false,
    sort_order: 2,
  },

  {
    name: "standard_monthly",
    display_name: "Standard — Monthly",
    description: "Unlimited bookings + priority support",
    target_role: "customer",
    plan_type: "recurring",
    interval: "monthly",
    prices: { NGN: 5000, USD: 6, GBP: 5, EUR: 5 },
    features: [
      "Unlimited bookings",
      "Top priority matching",
      "In-app chat & video call",
      "10% booking discount",
      "Dedicated support",
      "Background-checked maids only",
    ],
    bookings_per_month: null,
    discount_percent: 10,
    priority_matching: true,
    dedicated_support: true,
    badge: "Standard",
    trial_days: 7,
    is_featured: true,
    sort_order: 3,
  },

  {
    name: "standard_annual",
    display_name: "Standard — Annual",
    description: "Unlimited bookings + priority support — save 20%",
    target_role: "customer",
    plan_type: "recurring",
    interval: "annual",
    prices: { NGN: 48000, USD: 58, GBP: 46, EUR: 52 },
    features: [
      "Unlimited bookings",
      "Top priority matching",
      "In-app chat & video call",
      "10% booking discount",
      "Dedicated support",
      "Background-checked maids only",
      "2 months free vs monthly",
    ],
    bookings_per_month: null,
    discount_percent: 10,
    priority_matching: true,
    dedicated_support: true,
    badge: "Standard",
    trial_days: 0,
    is_featured: true,
    sort_order: 4,
  },

  {
    name: "premium_monthly",
    display_name: "Premium — Monthly",
    description: "The full Deusizi experience",
    target_role: "customer",
    plan_type: "recurring",
    interval: "monthly",
    prices: { NGN: 10000, USD: 12, GBP: 10, EUR: 11 },
    features: [
      "Unlimited bookings",
      "VIP maid matching",
      "In-app chat & video call",
      "15% booking discount",
      "24/7 dedicated support",
      "Background-checked maids only",
      "Free emergency rebooking",
      "Premium customer badge",
    ],
    bookings_per_month: null,
    discount_percent: 15,
    priority_matching: true,
    dedicated_support: true,
    badge: "Premium",
    trial_days: 14,
    is_featured: false,
    sort_order: 5,
  },

  {
    name: "premium_annual",
    display_name: "Premium — Annual",
    description: "The full Deusizi experience — save 20%",
    target_role: "customer",
    plan_type: "recurring",
    interval: "annual",
    prices: { NGN: 96000, USD: 115, GBP: 94, EUR: 106 },
    features: [
      "Unlimited bookings",
      "VIP maid matching",
      "In-app chat & video call",
      "15% booking discount",
      "24/7 dedicated support",
      "Background-checked maids only",
      "Free emergency rebooking",
      "Premium customer badge",
      "2 months free vs monthly",
    ],
    bookings_per_month: null,
    discount_percent: 15,
    priority_matching: true,
    dedicated_support: true,
    badge: "Premium",
    trial_days: 0,
    is_featured: false,
    sort_order: 6,
  },

  // ════════ MAID PLANS ════════

  {
    name: "maid_free",
    display_name: "Free",
    description: "Start accepting bookings",
    target_role: "maid",
    plan_type: "recurring",
    interval: "monthly",
    prices: { NGN: 0, USD: 0 },
    features: ["5 active bookings", "Basic profile listing", "In-app chat"],
    bookings_per_month: 5,
    discount_percent: 0,
    priority_matching: false,
    dedicated_support: false,
    badge: null,
    trial_days: 0,
    is_featured: false,
    sort_order: 0,
  },

  {
    name: "pro_monthly",
    display_name: "Pro — Monthly",
    description: "Grow your cleaning business",
    target_role: "maid",
    plan_type: "recurring",
    interval: "monthly",
    prices: { NGN: 3000, USD: 4, GBP: 3, EUR: 3 },
    features: [
      "Unlimited bookings",
      "Priority listing in search",
      "Pro badge on profile",
      "Advanced earnings analytics",
      "Dedicated maid support",
    ],
    bookings_per_month: null,
    discount_percent: 0,
    priority_matching: true,
    dedicated_support: true,
    badge: "Pro",
    trial_days: 7,
    is_featured: true,
    sort_order: 1,
  },

  {
    name: "pro_annual",
    display_name: "Pro — Annual",
    description: "Grow your cleaning business — save 20%",
    target_role: "maid",
    plan_type: "recurring",
    interval: "annual",
    prices: { NGN: 28800, USD: 38, GBP: 30, EUR: 34 },
    features: [
      "Unlimited bookings",
      "Priority listing in search",
      "Pro badge on profile",
      "Advanced earnings analytics",
      "Dedicated maid support",
      "2 months free vs monthly",
    ],
    bookings_per_month: null,
    discount_percent: 0,
    priority_matching: true,
    dedicated_support: true,
    badge: "Pro",
    trial_days: 0,
    is_featured: false,
    sort_order: 2,
  },

  {
    name: "pro_badge",
    display_name: "Verified Pro Badge",
    description: "One-time annual verification badge",
    target_role: "maid",
    plan_type: "one_time",
    interval: "annual",
    prices: { NGN: 5000, USD: 6, GBP: 5, EUR: 5 },
    features: [
      "Verified Pro badge on profile",
      "Priority listing in search",
      "Background check certificate",
      "Trust badge on bookings",
      "20% more booking visibility",
    ],
    bookings_per_month: null,
    discount_percent: 0,
    priority_matching: true,
    dedicated_support: false,
    badge: "Verified Pro",
    trial_days: 0,
    is_featured: false,
    sort_order: 3,
  },
];

async function run() {
  const client = await pool.connect();
  try {
    console.log("🔌 Connected to database\n");
    await client.query("BEGIN");

    // ── Ensure table has all needed columns ──
    await client.query(`
      ALTER TABLE subscription_plans
        ADD COLUMN IF NOT EXISTS paystack_plan_codes JSONB DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS stripe_price_ids    JSONB DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS is_popular          BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ DEFAULT now()
    `);
    console.log("✅ Schema up to date\n");

    // Mark Standard Monthly and Pro Monthly as popular
    const popularPlans = ["standard_monthly", "pro_monthly"];

    let inserted = 0;
    let updated = 0;

    for (const plan of PLANS) {
      const isPopular = popularPlans.includes(plan.name);

      const existing = await client.query(
        `SELECT id FROM subscription_plans WHERE name = $1`,
        [plan.name],
      );

      if (existing.rows.length) {
        // UPDATE existing plan (preserves paystack/stripe IDs)
        await client.query(
          `
          UPDATE subscription_plans SET
            display_name       = $1,
            description        = $2,
            target_role        = $3,
            plan_type          = $4,
            interval           = $5,
            prices             = $6,
            features           = $7,
            bookings_per_month = $8,
            discount_percent   = $9,
            priority_matching  = $10,
            dedicated_support  = $11,
            badge              = $12,
            trial_days         = $13,
            is_featured        = $14,
            is_popular         = $15,
            sort_order         = $16,
            is_active          = true,
            updated_at         = now()
          WHERE name = $17`,
          [
            plan.display_name,
            plan.description,
            plan.target_role,
            plan.plan_type,
            plan.interval,
            JSON.stringify(plan.prices),
            JSON.stringify(plan.features),
            plan.bookings_per_month || null,
            plan.discount_percent,
            plan.priority_matching,
            plan.dedicated_support,
            plan.badge || null,
            plan.trial_days,
            plan.is_featured,
            isPopular,
            plan.sort_order,
            plan.name,
          ],
        );
        console.log(
          `  ↺  Updated  — ${plan.target_role.padEnd(8)} | ${plan.display_name}`,
        );
        updated++;
      } else {
        // INSERT new plan
        await client.query(
          `
          INSERT INTO subscription_plans (
            name, display_name, description, target_role, plan_type, interval,
            prices, features, bookings_per_month, discount_percent,
            priority_matching, dedicated_support, badge, trial_days,
            is_featured, is_popular, sort_order, is_active
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,true
          )`,
          [
            plan.name,
            plan.display_name,
            plan.description,
            plan.target_role,
            plan.plan_type,
            plan.interval,
            JSON.stringify(plan.prices),
            JSON.stringify(plan.features),
            plan.bookings_per_month || null,
            plan.discount_percent,
            plan.priority_matching,
            plan.dedicated_support,
            plan.badge || null,
            plan.trial_days,
            plan.is_featured,
            isPopular,
            plan.sort_order,
          ],
        );
        console.log(
          `  ✅ Inserted — ${plan.target_role.padEnd(8)} | ${plan.display_name}`,
        );
        inserted++;
      }
    }

    // ── Deactivate any plans not in the seed list ──
    const planNames = PLANS.map((p) => p.name);
    const { rowCount } = await client.query(
      `UPDATE subscription_plans SET is_active = false
       WHERE name != ALL($1::text[]) AND is_active = true`,
      [planNames],
    );
    if (rowCount > 0) {
      console.log(
        `\n  ⚠️  Deactivated ${rowCount} old plan(s) not in seed list`,
      );
    }

    await client.query("COMMIT");

    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Seed complete
   Inserted : ${inserted}
   Updated  : ${updated}
   Total    : ${PLANS.length} plans
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Customer plans : Free, Basic (mo/yr), Standard (mo/yr)★, Premium (mo/yr)
Maid plans     : Free, Pro (mo/yr)★, Verified Pro Badge

★ = marked as most popular
`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n❌ Seed failed — rolled back");
    console.error(err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
