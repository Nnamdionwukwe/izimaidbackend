// db/check-subscription-plans.js
import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    "postgresql://postgres:lFTWaNFqrAsULGNgOuwhZkrdjAIlHIMq@centerbeam.proxy.rlwy.net:46630/railway",
  ssl: false,
});

const client = await pool.connect();

try {
  console.log("\n🔍 Checking subscription_plans table...\n");

  // 1. Check if table exists
  const { rows: tableCheck } = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'subscription_plans'
    ) AS exists
  `);

  if (!tableCheck[0].exists) {
    console.log("❌ subscription_plans table does not exist!");
    console.log("   Run your migration first.\n");
    process.exit(1);
  }

  // 2. Fetch all plans
  const { rows: plans } = await client.query(`
    SELECT id, name, display_name, prices, is_active, target_role, interval, 
           bookings_per_month, features, trial_days, sort_order
    FROM subscription_plans
    ORDER BY sort_order ASC, name ASC
  `);

  if (plans.length === 0) {
    console.log("⚠️  No subscription plans found. Creating default plans...\n");

    await client.query(`
      INSERT INTO subscription_plans 
        (name, display_name, description, target_role, plan_type, interval, 
         prices, features, bookings_per_month, discount_percent, 
         priority_matching, dedicated_support, badge, trial_days, 
         is_active, is_popular, sort_order)
      VALUES
        ('free', 'Free', 'Basic access with limited bookings', 'customer', 'recurring', 'monthly',
         '{"NGN": 0, "USD": 0, "GBP": 0}'::jsonb,
         '["2 bookings per month", "Basic search", "Standard support"]'::jsonb,
         2, 0, false, false, null, 0, true, false, 1),

        ('basic', 'Basic Plan', 'Great for regular customers who need reliable cleaning', 'customer', 'recurring', 'monthly',
         '{"NGN": 5000, "USD": 10, "GBP": 8, "GHS": 150, "KES": 1500, "ZAR": 180}'::jsonb,
         '["10 bookings per month", "Priority search results", "Email support", "Booking history"]'::jsonb,
         10, 5, false, false, '🥉', 0, true, false, 2),

        ('premium', 'Premium Plan', 'Unlimited bookings with premium features and priority matching', 'customer', 'recurring', 'monthly',
         '{"NGN": 15000, "USD": 30, "GBP": 25, "GHS": 450, "KES": 4500, "ZAR": 550}'::jsonb,
         '["Unlimited bookings", "Priority matching", "Dedicated support", "10% booking discount", "Verified badge"]'::jsonb,
         null, 10, true, true, '⭐', 7, true, true, 3),

        ('annual', 'Annual Premium', 'Best value — save 20% with annual billing', 'customer', 'recurring', 'annual',
         '{"NGN": 144000, "USD": 288, "GBP": 240, "GHS": 4320, "KES": 43200, "ZAR": 5280}'::jsonb,
         '["Everything in Premium", "20% savings vs monthly", "Priority matching", "Dedicated support", "Annual badge"]'::jsonb,
         null, 15, true, true, '💎', 14, true, false, 4)
      ON CONFLICT (name) DO NOTHING
    `);

    const { rows: newPlans } = await client.query(`
      SELECT name, display_name, prices, is_active FROM subscription_plans ORDER BY sort_order
    `);
    console.log("✅ Created plans:\n");
    newPlans.forEach((p) => {
      console.log(
        `   ${p.is_active ? "✅" : "❌"} ${p.display_name} (${p.name})`,
      );
      console.log(`      Prices: ${JSON.stringify(p.prices)}\n`);
    });
  } else {
    // 3. Display current plans and check for issues
    console.log(`Found ${plans.length} plan(s):\n`);

    let hasIssues = false;

    plans.forEach((p) => {
      const prices = p.prices || {};
      const ngnPrice = prices.NGN || prices.ngn || 0;
      const usdPrice = prices.USD || prices.usd || 0;
      const hasPrices = Object.values(prices).some((v) => Number(v) > 0);
      const isFree = p.name === "free";

      const status = p.is_active ? "✅" : "❌";
      const priceStatus = isFree ? "🆓" : hasPrices ? "💰" : "⚠️ NO PRICES";

      console.log(
        `   ${status} ${p.display_name} (${p.name}) — ${priceStatus}`,
      );
      console.log(
        `      Role: ${p.target_role} | Interval: ${p.interval} | Bookings: ${p.bookings_per_month || "unlimited"}`,
      );
      console.log(`      Prices: ${JSON.stringify(prices)}`);
      console.log(`      Features: ${JSON.stringify(p.features || [])}`);
      console.log();

      if (!isFree && !hasPrices) {
        hasIssues = true;
      }
    });

    // 4. Fix plans with missing/zero prices
    if (hasIssues) {
      console.log(
        "⚠️  Some paid plans have zero or missing prices. Fixing...\n",
      );

      const defaultPrices = {
        basic: { NGN: 5000, USD: 10, GBP: 8, GHS: 150, KES: 1500, ZAR: 180 },
        premium: {
          NGN: 15000,
          USD: 30,
          GBP: 25,
          GHS: 450,
          KES: 4500,
          ZAR: 550,
        },
        pro: { NGN: 25000, USD: 50, GBP: 40, GHS: 750, KES: 7500, ZAR: 900 },
      };

      for (const plan of plans) {
        if (plan.name === "free") continue;

        const prices = plan.prices || {};
        const hasPrices = Object.values(prices).some((v) => Number(v) > 0);

        if (!hasPrices) {
          // Find best matching default
          const key =
            Object.keys(defaultPrices).find((k) => plan.name.includes(k)) ||
            "basic";
          const newPrices = defaultPrices[key];

          await client.query(
            `UPDATE subscription_plans SET prices = $1::jsonb WHERE id = $2`,
            [JSON.stringify(newPrices), plan.id],
          );

          console.log(
            `   ✅ Fixed "${plan.display_name}" → ${JSON.stringify(newPrices)}`,
          );
        }
      }

      console.log("\n✅ All plans now have prices.\n");
    } else {
      console.log("✅ All paid plans have valid prices. No issues found.\n");
    }
  }

  // 5. Final summary
  const { rows: final } = await client.query(`
    SELECT name, display_name, prices->>'NGN' as ngn, prices->>'USD' as usd, is_active
    FROM subscription_plans
    ORDER BY sort_order
  `);

  console.log("📋 Final plan summary:");
  console.log("─".repeat(60));
  console.log("   Name                 NGN         USD      Active");
  console.log("─".repeat(60));
  final.forEach((p) => {
    const ngn = p.ngn ? `₦${Number(p.ngn).toLocaleString()}` : "—";
    const usd = p.usd ? `$${Number(p.usd)}` : "—";
    console.log(
      `   ${(p.display_name || p.name).padEnd(20)} ${ngn.padEnd(12)} ${usd.padEnd(8)} ${p.is_active ? "✅" : "❌"}`,
    );
  });
  console.log("─".repeat(60));
  console.log();
} catch (err) {
  console.error("❌ Error:", err.message);
  console.error(err.stack);
} finally {
  client.release();
  await pool.end();
  console.log("Done.\n");
}
