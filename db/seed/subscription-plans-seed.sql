-- db/seed/subscription-plans-seed.sql
-- Reference data: minimum plans referenced by subscriptions.controller.js
-- Add more from production once you've decided your tiers.

INSERT INTO subscription_plans (name, display_name, description, target_role, plan_type, interval,
                                prices, features, bookings_per_month, discount_percent,
                                priority_matching, dedicated_support, badge, trial_days,
                                is_active, is_featured, is_popular, sort_order)
VALUES
  -- Free tier — default for all new users
  ('free', 'Free', 'Get started with basic access',
   'both', 'free', 'monthly',
   '{"NGN": 0, "USD": 0, "GBP": 0, "EUR": 0}'::jsonb,
   '["2 bookings per month", "Standard matching", "Basic support"]'::jsonb,
   2, 0, false, false, NULL, 0,
   true, false, false, 0),

  -- Pro badge — used to mark verified maids; grants id_verified
  ('pro_badge', 'Pro Badge', 'Stand out with a verified badge',
   'maid', 'one_time', 'monthly',
   '{"NGN": 10000, "USD": 10, "GBP": 8, "EUR": 9}'::jsonb,
   '["Verified badge", "Priority in search", "Background check included"]'::jsonb,
   NULL, 0, true, false, 'pro', 0,
   true, true, false, 10)
ON CONFLICT (name) DO NOTHING;