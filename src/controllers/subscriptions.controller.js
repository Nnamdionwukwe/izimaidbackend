// src/controllers/subscriptions.controller.js
import Stripe from "stripe";
import { notify } from "../utils/notify.js";
import {
  sendSubscriptionConfirmationEmail,
  sendSubscriptionRenewalEmail,
  sendSubscriptionCancelledEmail,
  sendSubscriptionExpiredEmail,
  sendSubscriptionPaymentFailedEmail,
  sendTrialEndingEmail,
  sendProBadgeActivatedEmail,
} from "../utils/mailer.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE = "https://api.paystack.co";

async function paystackRequest(method, path, body) {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ── Helper: get plan by id or name ────────────────────────────────────
async function getPlan(db, planIdOrName) {
  // UUID pattern check
  const isUUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      planIdOrName,
    );

  const { rows } = await db.query(
    isUUID
      ? `SELECT * FROM subscription_plans WHERE id = $1::uuid`
      : `SELECT * FROM subscription_plans WHERE name = $1`,
    [planIdOrName],
  );
  return rows[0] || null;
}

// ── Helper: get active subscription for user ──────────────────────────
async function getActiveSub(db, userId) {
  const { rows } = await db.query(
    `SELECT s.*, sp.name as plan_name, sp.display_name, sp.features,
            sp.bookings_per_month, sp.discount_percent, sp.prices,
            sp.priority_matching, sp.dedicated_support, sp.badge
     FROM subscriptions s
     JOIN subscription_plans sp ON sp.id = s.plan_id
     WHERE s.user_id = $1
       AND s.status IN ('active','trialing','past_due','paused')
     ORDER BY s.created_at DESC LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

// ── Helper: apply promo code ──────────────────────────────────────────
async function applyPromo(db, code, planName, currency) {
  if (!code) return { discount: 0, promo: null };

  const { rows } = await db.query(
    `SELECT * FROM promo_codes
     WHERE code = $1
       AND is_active = true
       AND (max_uses IS NULL OR uses_count < max_uses)
       AND valid_from <= now()
       AND (valid_until IS NULL OR valid_until >= now())
       AND (currency IS NULL OR currency = $2)`,
    [code.toUpperCase(), currency],
  );

  if (!rows.length)
    return { discount: 0, promo: null, error: "invalid or expired promo code" };

  const promo = rows[0];
  return {
    discount: Number(promo.discount_value),
    type: promo.discount_type,
    promo,
  };
}

// ── Helper: calculate final price with promo ──────────────────────────
function calcFinalPrice(basePrice, discount, discountType) {
  if (!discount) return basePrice;
  if (discountType === "percent") {
    return Math.max(0, basePrice - (basePrice * discount) / 100);
  }
  return Math.max(0, basePrice - discount);
}

// ──────────────────────────────────────────────────────────────────────
//  PUBLIC
// ──────────────────────────────────────────────────────────────────────

// GET /api/subscriptions/plans
// REPLACE the getPlans function with:
export const getPlans = async (req, res) => {
  const { role = "customer", currency = "NGN", interval } = req.query;

  try {
    const conditions = ["is_active = true", "target_role = $1"];
    const params = [role];

    if (interval) {
      params.push(interval);
      conditions.push(`interval = $${params.length}`);
    }

    const { rows } = await req.db.query(
      `SELECT id, name, display_name, description, target_role,
              plan_type, interval, prices, features,
              bookings_per_month, discount_percent, priority_matching,
              dedicated_support, badge, trial_days, is_featured,
              is_popular, sort_order
       FROM subscription_plans
       WHERE ${conditions.join(" AND ")}
       ORDER BY sort_order ASC`,
      params,
    );

    const plans = rows.map((p) => ({
      ...p,
      price: p.prices[currency] || p.prices["USD"] || 0,
      currency,
    }));

    return res.json({ plans });
  } catch (err) {
    console.error("[subscriptions/getPlans]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
// GET /api/subscriptions/my
export const getMySubscription = async (req, res) => {
  try {
    const sub = await getActiveSub(req.db, req.user.id);

    if (!sub) {
      // Return free plan info
      const freePlan = await getPlan(req.db, "free");
      return res.json({
        subscription: null,
        plan: freePlan,
        is_free: true,
        bookings_used: 0,
        bookings_limit: 2,
      });
    }

    // Get invoices
    const { rows: invoices } = await req.db.query(
      `SELECT id, amount, currency, status, period_start, period_end, paid_at, created_at
       FROM subscription_invoices
       WHERE subscription_id = $1
       ORDER BY created_at DESC LIMIT 6`,
      [sub.id],
    );

    return res.json({
      subscription: sub,
      invoices,
      is_free: false,
      bookings_used: sub.bookings_used,
      bookings_limit: sub.bookings_per_month,
    });
  } catch (err) {
    console.error("[subscriptions/getMySubscription]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// POST /api/subscriptions/validate-promo
export const validatePromo = async (req, res) => {
  const { code, plan_name, currency = "NGN" } = req.body;
  if (!code) return res.status(400).json({ error: "code is required" });

  const { discount, type, promo, error } = await applyPromo(
    req.db,
    code,
    plan_name,
    currency,
  );
  if (error) return res.status(400).json({ error });

  return res.json({
    valid: true,
    discount_type: type,
    discount_value: discount,
    discount_percent: type === "percent" ? discount : 0, // ← ADD this
    description: promo.description,
  });
};

// ──────────────────────────────────────────────────────────────────────
//  SUBSCRIBE — PAYSTACK (Africa)
// ──────────────────────────────────────────────────────────────────────

export const subscribePaystack = async (req, res) => {
  const { plan_id, currency = "NGN", promo_code } = req.body;
  if (!plan_id) return res.status(400).json({ error: "plan_id is required" });

  try {
    const plan = await getPlan(req.db, plan_id);
    if (!plan) return res.status(404).json({ error: "plan not found" });

    // Check no active subscription
    const existing = await getActiveSub(req.db, req.user.id);
    if (existing) {
      return res.status(409).json({
        error: "you already have an active subscription",
        current_plan: existing.display_name,
      });
    }

    // Get price for currency
    const basePrice = plan.prices[currency] || plan.prices["NGN"] || 0;
    if (basePrice === 0) {
      // Free plan — activate directly
      return await activateFreePlan(req, res, plan);
    }

    // Apply promo
    const {
      discount,
      type: discountType,
      promo,
      error: promoErr,
    } = await applyPromo(req.db, promo_code, plan.name, currency);
    if (promo_code && promoErr)
      return res.status(400).json({ error: promoErr });

    const finalPrice = calcFinalPrice(basePrice, discount, discountType);

    // Get user email
    const { rows: userRows } = await req.db.query(
      `SELECT name, email FROM users WHERE id = $1`,
      [req.user.id],
    );
    const user = userRows[0];

    // Initialize Paystack transaction
    const reference = `ds_sub_${req.user.id.slice(0, 8)}_${Date.now()}`;
    const paystackRes = await paystackRequest(
      "POST",
      "/transaction/initialize",
      {
        email: user.email,
        amount: Math.round(finalPrice * 100), // kobo
        currency,
        reference,
        callback_url: `${process.env.CLIENT_URL}/subscription/verify?gateway=paystack`,
        metadata: {
          user_id: req.user.id,
          plan_id: plan.id,
          plan_name: plan.name,
          currency,
          promo_code: promo_code || null,
        },
        // For recurring — Paystack will create a subscription after first payment
        plan: plan.paystack_plan_codes?.[currency] || undefined,
      },
    );

    if (!paystackRes.status) {
      return res.status(502).json({
        error: "payment initialization failed",
        details: paystackRes.message,
      });
    }

    return res.json({
      gateway: "paystack",
      authorization_url: paystackRes.data.authorization_url,
      access_code: paystackRes.data.access_code,
      reference: paystackRes.data.reference,
      amount: finalPrice,
      currency,
      discount_applied:
        discount > 0 ? { type: discountType, value: discount } : null,
    });
  } catch (err) {
    console.error("[subscriptions/subscribePaystack]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ──────────────────────────────────────────────────────────────────────
//  SUBSCRIBE — STRIPE (Global)
// ──────────────────────────────────────────────────────────────────────

export const subscribeStripe = async (req, res) => {
  const { plan_id, currency = "usd", promo_code } = req.body;
  if (!plan_id) return res.status(400).json({ error: "plan_id is required" });

  try {
    const plan = await getPlan(req.db, plan_id);
    if (!plan) return res.status(404).json({ error: "plan not found" });

    const existing = await getActiveSub(req.db, req.user.id);
    if (existing) {
      return res.status(409).json({
        error: "you already have an active subscription",
        current_plan: existing.display_name,
      });
    }

    const currencyUpper = currency.toUpperCase();
    const basePrice = plan.prices[currencyUpper] || plan.prices["USD"] || 0;
    if (basePrice === 0) return await activateFreePlan(req, res, plan);

    const {
      discount,
      type: discountType,
      promo,
      error: promoErr,
    } = await applyPromo(req.db, promo_code, plan.name, currencyUpper);
    if (promo_code && promoErr)
      return res.status(400).json({ error: promoErr });

    const finalPrice = calcFinalPrice(basePrice, discount, discountType);

    const { rows: userRows } = await req.db.query(
      `SELECT name, email FROM users WHERE id = $1`,
      [req.user.id],
    );
    const user = userRows[0];

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: Math.round(finalPrice * 100),
            product_data: {
              name: `${plan.display_name} — ${process.env.APP_NAME}`,
              description: plan.description || "",
            },
            recurring: {
              interval: plan.interval === "annual" ? "year" : "month",
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.CLIENT_URL}/subscription/verify?gateway=stripe&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/pricing?cancelled=1`,
      metadata: {
        user_id: req.user.id,
        plan_id: plan.id,
        plan_name: plan.name,
        currency: currencyUpper,
        promo_code: promo_code || "",
      },
      // Trial period
      ...(plan.trial_days > 0
        ? {
            subscription_data: {
              trial_period_days: plan.trial_days,
            },
          }
        : {}),
    });

    return res.json({
      gateway: "stripe",
      session_id: session.id,
      url: session.url,
      amount: finalPrice,
      currency: currencyUpper,
    });
  } catch (err) {
    console.error("[subscriptions/subscribeStripe]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ──────────────────────────────────────────────────────────────────────
//  ACTIVATE FREE PLAN (internal helper)
// ──────────────────────────────────────────────────────────────────────

async function activateFreePlan(req, res, plan) {
  const now = new Date();
  const expiry = new Date(now);
  expiry.setMonth(expiry.getMonth() + 1);

  const { rows } = await req.db.query(
    `INSERT INTO subscriptions
       (user_id, plan_id, status, currency, amount, interval,
        current_period_start, current_period_end, gateway, auto_renew)
     VALUES ($1,$2,'active','NGN',0,'monthly',$3,$4,'manual',true)
     RETURNING *`,
    [req.user.id, plan.id, now, expiry],
  );

  await req.db.query(`UPDATE users SET subscription_plan = $1 WHERE id = $2`, [
    plan.name,
    req.user.id,
  ]);

  return res.status(201).json({
    message: "Free plan activated",
    subscription: rows[0],
    plan,
  });
}

// ──────────────────────────────────────────────────────────────────────
//  VERIFY PAYMENT & ACTIVATE SUBSCRIPTION
// ──────────────────────────────────────────────────────────────────────

export const verifySubscriptionPayment = async (req, res) => {
  const { gateway, reference, session_id } = req.query;

  try {
    let userId, planId, currency, promoCode, amount;

    if (gateway === "stripe" && session_id) {
      const session = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ["subscription"],
      });

      if (session.payment_status !== "paid" && session.status !== "complete") {
        return res.status(402).json({ error: "payment not completed" });
      }

      userId = session.metadata.user_id;
      planId = session.metadata.plan_id;
      currency = session.metadata.currency;
      promoCode = session.metadata.promo_code;
      amount = session.amount_total / 100;

      await activateSubscription(req.db, {
        userId,
        planId,
        currency,
        amount,
        gateway: "stripe",
        stripe_sub_id: session.subscription?.id,
        stripe_cus_id: session.customer,
        promoCode,
        interval:
          session.subscription?.items?.data[0]?.price?.recurring?.interval ||
          "month",
        trial_end: session.subscription?.trial_end
          ? new Date(session.subscription.trial_end * 1000)
          : null,
      });
    } else if (reference) {
      // Paystack
      const psRes = await paystackRequest(
        "GET",
        `/transaction/verify/${reference}`,
      );
      if (!psRes.status || psRes.data.status !== "success") {
        return res.status(402).json({ error: "payment not verified" });
      }

      const meta = psRes.data.metadata;
      userId = meta.user_id;
      planId = meta.plan_id;
      currency = meta.currency || "NGN";
      promoCode = meta.promo_code;
      amount = psRes.data.amount / 100;

      await activateSubscription(req.db, {
        userId,
        planId,
        currency,
        amount,
        gateway: "paystack",
        paystack_sub_code: psRes.data.plan_object?.subscription_code,
        paystack_token: psRes.data.plan_object?.email_token,
        promoCode,
        interval: "monthly",
      });
    } else {
      return res
        .status(400)
        .json({ error: "gateway and reference/session_id are required" });
    }

    // Fetch activated subscription
    // In verifySubscriptionPayment, REPLACE the notify call after activateSubscription with:

    const sub = await getActiveSub(req.db, userId);
    const plan = await getPlan(req.db, planId);
    const { rows: userRows } = await req.db.query(
      `SELECT name, email FROM users WHERE id = $1`,
      [userId],
    );
    const user = userRows[0];

    // ── In-app + email notification ──
    await notify(req.db, {
      userId,
      type: "payment_received",
      title: `${plan.display_name} subscription activated 🎉`,
      body: `Your ${plan.display_name} subscription is now active. Enjoy your benefits!`,
      priority: "high",
      action_url: "/settings",
      data: {
        plan_name: plan.name,
        plan_id: planId,
        amount: sub.amount,
        currency: sub.currency,
      },
      sendMail: () => sendSubscriptionConfirmationEmail(user, plan, sub),
    });

    // ── Pro badge email ──
    if (plan.name === "pro_badge" || plan.name?.includes("pro")) {
      sendProBadgeActivatedEmail(user).catch(console.error);
    }

    // ADD trial ending check to verifySubscriptionPayment, after notify:
    if (sub.trial_end) {
      const daysToTrialEnd = Math.ceil(
        (new Date(sub.trial_end) - Date.now()) / 86400000,
      );
      if (daysToTrialEnd <= 3 && daysToTrialEnd > 0) {
        sendTrialEndingEmail(user, plan, daysToTrialEnd).catch(console.error);
      }
    }

    // Increment promo uses
    if (promoCode) {
      await req.db.query(
        `UPDATE promo_codes SET uses_count = uses_count + 1 WHERE code = $1`,
        [promoCode.toUpperCase()],
      );
    }

    return res.json({
      message: "Subscription activated",
      subscription: sub,
      plan,
    });
  } catch (err) {
    console.error("[subscriptions/verifySubscriptionPayment]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Internal: activate subscription in DB ────────────────────────────
async function activateSubscription(
  db,
  {
    userId,
    planId,
    currency,
    amount,
    gateway,
    stripe_sub_id,
    stripe_cus_id,
    paystack_sub_code,
    paystack_token,
    promoCode,
    interval,
    trial_end,
  },
) {
  const plan = await getPlan(db, planId);

  // Cancel any existing subscription first
  await db.query(
    `UPDATE subscriptions
     SET status = 'cancelled', cancelled_at = now(), cancel_at_period_end = false
     WHERE user_id = $1 AND status IN ('active','trialing','past_due','paused')`,
    [userId],
  );

  const now = new Date();
  // REPLACE this section (normalizedInterval declaration through expiry):
  const normalizedInterval =
    interval === "year"
      ? "annual"
      : interval === "month"
        ? "monthly"
        : interval === "annual"
          ? "annual"
          : interval === "monthly"
            ? "monthly"
            : interval === "quarter"
              ? "quarterly"
              : "monthly";

  const periodMonths = // ← this was missing, causing ReferenceError
    normalizedInterval === "annual"
      ? 12
      : normalizedInterval === "quarterly"
        ? 3
        : 1;

  const expiry = new Date(now);
  expiry.setMonth(expiry.getMonth() + periodMonths);

  const status = trial_end ? "trialing" : "active";

  const { rows } = await db.query(
    `INSERT INTO subscriptions (
      user_id, plan_id, status, currency, amount, interval,
      current_period_start, current_period_end,
      trial_start, trial_end,
      gateway, stripe_sub_id, stripe_customer_id,
      paystack_sub_code, paystack_email_token,
      promo_code, discount_percent, auto_renew
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,true
    ) RETURNING *`,
    [
      userId,
      planId,
      status,
      currency,
      amount,
      normalizedInterval,
      now,
      expiry,
      trial_end ? now : null,
      trial_end || null,
      gateway,
      stripe_sub_id || null,
      stripe_cus_id || null,
      paystack_sub_code || null,
      paystack_token || null,
      promoCode || null,
      0,
    ],
  );

  // Create invoice
  await db.query(
    `INSERT INTO subscription_invoices
       (subscription_id, user_id, amount, currency, status, gateway,
        period_start, period_end, paid_at)
     VALUES ($1,$2,$3,$4,'paid',$5,$6,$7,now())`,
    [rows[0].id, userId, amount, currency, gateway, now, expiry],
  );

  // Update user subscription plan + badge
  await db.query(
    `UPDATE users
     SET subscription_plan = $1, subscription_badge = $2
     WHERE id = $3`,
    [plan.name, plan.badge, userId],
  );

  // Special: activate Pro badge for maids
  // In activateSubscription, after the pro_badge check, ADD:
  if (plan.name === "pro_badge") {
    const { rows: maidRows } = await db.query(
      `SELECT name, email FROM users WHERE id = $1`,
      [userId],
    );
    if (maidRows.length) {
      sendProBadgeActivatedEmail(maidRows[0]).catch(console.error);
    }
  }

  return rows[0];
}

// ──────────────────────────────────────────────────────────────────────
//  CANCEL SUBSCRIPTION
// ──────────────────────────────────────────────────────────────────────

export const cancelSubscription = async (req, res) => {
  const { reason, immediate = false } = req.body;

  try {
    const sub = await getActiveSub(req.db, req.user.id);
    if (!sub) return res.status(404).json({ error: "no active subscription" });

    const plan = await getPlan(req.db, sub.plan_id);

    if (immediate) {
      // Cancel immediately
      await req.db.query(
        `UPDATE subscriptions
         SET status = 'cancelled', cancelled_at = now(),
             cancel_at_period_end = false, cancellation_reason = $1
         WHERE id = $2`,
        [reason || null, sub.id],
      );
      await req.db.query(
        `UPDATE users SET subscription_plan = 'free', subscription_badge = null WHERE id = $1`,
        [req.user.id],
      );
    } else {
      // Cancel at end of period
      await req.db.query(
        `UPDATE subscriptions
         SET cancel_at_period_end = true, cancelled_at = now(),
             cancellation_reason = $1
         WHERE id = $2`,
        [reason || null, sub.id],
      );
    }

    // Cancel on gateway
    if (sub.stripe_sub_id) {
      try {
        if (immediate) {
          await stripe.subscriptions.cancel(sub.stripe_sub_id);
        } else {
          await stripe.subscriptions.update(sub.stripe_sub_id, {
            cancel_at_period_end: true,
          });
        }
      } catch (err) {
        console.error(
          "[subscriptions/cancel] Stripe cancel failed:",
          err.message,
        );
      }
    }

    if (sub.paystack_sub_code) {
      try {
        await paystackRequest("POST", `/subscription/disable`, {
          code: sub.paystack_sub_code,
          token: sub.paystack_email_token,
        });
      } catch (err) {
        console.error(
          "[subscriptions/cancel] Paystack cancel failed:",
          err.message,
        );
      }
    }

    const { rows: userRows } = await req.db.query(
      `SELECT name, email FROM users WHERE id = $1`,
      [req.user.id],
    );

    await notify(req.db, {
      userId: req.user.id,
      type: "payment_receipt",
      title: "Subscription cancelled",
      body: immediate
        ? "Your subscription has been cancelled immediately."
        : `Your subscription will remain active until ${new Date(sub.current_period_end).toDateString()}.`,
      action_url: "/pricing",
      sendMail: () =>
        sendSubscriptionCancelledEmail(userRows[0], plan, {
          ...sub,
          cancel_at_period_end: !immediate,
          cancellation_reason: reason,
        }),
    });

    return res.json({
      message: immediate
        ? "Subscription cancelled immediately."
        : `Subscription will end on ${new Date(sub.current_period_end).toDateString()}.`,
      cancel_at_period_end: !immediate,
      period_end: sub.current_period_end,
    });
  } catch (err) {
    console.error("[subscriptions/cancelSubscription]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ──────────────────────────────────────────────────────────────────────
//  PAUSE / RESUME
// ──────────────────────────────────────────────────────────────────────

export const pauseSubscription = async (req, res) => {
  try {
    const sub = await getActiveSub(req.db, req.user.id);
    if (!sub || sub.status !== "active") {
      return res.status(404).json({ error: "no active subscription to pause" });
    }

    await req.db.query(
      `UPDATE subscriptions SET status = 'paused', paused_at = now()
       WHERE id = $1`,
      [sub.id],
    );

    await notify(req.db, {
      userId: req.user.id,
      type: "payment_receipt",
      title: "Subscription paused",
      body: "Your subscription has been paused. Resume anytime.",
      action_url: "/settings/subscription",
    });

    return res.json({ message: "Subscription paused" });
  } catch (err) {
    console.error("[subscriptions/pauseSubscription]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const resumeSubscription = async (req, res) => {
  try {
    const { rows: subRows } = await req.db.query(
      `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'paused'
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id],
    );
    if (!subRows.length)
      return res.status(404).json({ error: "no paused subscription" });

    const sub = subRows[0];

    // Extend period by days paused
    const daysPaused = Math.ceil(
      (Date.now() - new Date(sub.paused_at).getTime()) / (1000 * 60 * 60 * 24),
    );
    const newExpiry = new Date(sub.current_period_end);
    newExpiry.setDate(newExpiry.getDate() + daysPaused);

    await req.db.query(
      `UPDATE subscriptions
       SET status = 'active', resumed_at = now(), current_period_end = $1
       WHERE id = $2`,
      [newExpiry, sub.id],
    );

    await notify(req.db, {
      userId: req.user.id,
      type: "payment_received",
      title: "Subscription resumed",
      body: `Your subscription is active again. It's been extended to ${newExpiry.toDateString()}.`,
      action_url: "/settings/subscription",
    });

    return res.json({ message: "Subscription resumed", new_expiry: newExpiry });
  } catch (err) {
    console.error("[subscriptions/resumeSubscription]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ──────────────────────────────────────────────────────────────────────
//  UPGRADE / DOWNGRADE
// ──────────────────────────────────────────────────────────────────────

export const changePlan = async (req, res) => {
  const { new_plan_id, promo_code } = req.body;
  if (!new_plan_id)
    return res.status(400).json({ error: "new_plan_id is required" });

  try {
    const currentSub = await getActiveSub(req.db, req.user.id);
    const newPlan = await getPlan(req.db, new_plan_id);
    if (!newPlan) return res.status(404).json({ error: "plan not found" });

    if (currentSub && currentSub.plan_id === newPlan.id) {
      return res.status(409).json({ error: "already on this plan" });
    }

    const currency = currentSub?.currency || "NGN";
    const basePrice = newPlan.prices[currency] || newPlan.prices["NGN"] || 0;

    const { discount, type: discountType } = await applyPromo(
      req.db,
      promo_code,
      newPlan.name,
      currency,
    );
    const finalPrice = calcFinalPrice(basePrice, discount, discountType);

    // For Stripe — update subscription
    if (currentSub?.stripe_sub_id) {
      const stripeSub = await stripe.subscriptions.retrieve(
        currentSub.stripe_sub_id,
      );
      await stripe.subscriptions.update(currentSub.stripe_sub_id, {
        items: [
          {
            id: stripeSub.items.data[0].id,
            price: newPlan.stripe_price_ids?.monthly,
          },
        ],
        proration_behavior: "create_prorations",
      });
    }

    // Update subscription in DB
    await req.db.query(
      `UPDATE subscriptions
       SET plan_id = $1, amount = $2, promo_code = $3, updated_at = now()
       WHERE id = $4`,
      [newPlan.id, finalPrice, promo_code || null, currentSub?.id],
    );

    await req.db.query(
      `UPDATE users SET subscription_plan = $1, subscription_badge = $2 WHERE id = $3`,
      [newPlan.name, newPlan.badge, req.user.id],
    );

    await notify(req.db, {
      userId: req.user.id,
      type: "payment_received",
      title: `Plan changed to ${newPlan.display_name}`,
      body: `Your subscription has been updated to ${newPlan.display_name}.`,
      action_url: "/settings/subscription",
      data: { plan_name: newPlan.name },
    });

    return res.json({
      message: `Plan changed to ${newPlan.display_name}`,
      plan: newPlan,
    });
  } catch (err) {
    console.error("[subscriptions/changePlan]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ──────────────────────────────────────────────────────────────────────
//  WEBHOOKS
// ──────────────────────────────────────────────────────────────────────

export const paystackSubscriptionWebhook = async (req, res) => {
  const signature = req.headers["x-paystack-signature"];
  const crypto = await import("crypto");
  const hash = crypto.default
    .createHmac("sha512", PAYSTACK_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash !== signature)
    return res.status(401).json({ error: "invalid signature" });

  const { event, data } = req.body;

  try {
    if (event === "subscription.create") {
      await req.db.query(
        `UPDATE subscriptions
         SET paystack_sub_code = $1, status = 'active'
         WHERE paystack_email_token = $2`,
        [data.subscription_code, data.email_token],
      );
    }

    if (event === "invoice.payment_success") {
      const { rows: subRows } = await req.db.query(
        `SELECT s.*, sp.display_name, u.name, u.email
         FROM subscriptions s
         JOIN subscription_plans sp ON sp.id = s.plan_id
         JOIN users u ON u.id = s.user_id
         WHERE s.paystack_sub_code = $1`,
        [data.subscription.subscription_code],
      );

      if (subRows.length) {
        const sub = subRows[0];
        const now = new Date();
        const expiry = new Date(now);
        expiry.setMonth(expiry.getMonth() + 1);

        await req.db.query(
          `UPDATE subscriptions
           SET status = 'active', current_period_start = $1,
               current_period_end = $2, bookings_used = 0, updated_at = now()
           WHERE id = $3`,
          [now, expiry, sub.id],
        );

        await req.db.query(
          `INSERT INTO subscription_invoices
             (subscription_id, user_id, amount, currency, status, gateway,
              period_start, period_end, paid_at)
           VALUES ($1,$2,$3,$4,'paid','paystack',$5,$6,now())`,
          [sub.id, sub.user_id, data.amount / 100, "NGN", now, expiry],
        );

        await notify(req.db, {
          userId: sub.user_id,
          type: "payment_received",
          title: "Subscription renewed",
          body: `Your ${sub.display_name} subscription has been renewed.`,
          action_url: "/settings/subscription",
          sendMail: () =>
            sendSubscriptionRenewalEmail(
              { name: sub.name, email: sub.email },
              sub,
              {
                currency: "NGN",
                amount: data.amount / 100,
                period_start: now,
                period_end: expiry,
              },
            ),
        });
      }
    }

    if (event === "invoice.payment_failed") {
      await req.db.query(
        `UPDATE subscriptions SET status = 'past_due'
         WHERE paystack_sub_code = $1`,
        [data.subscription.subscription_code],
      );
    }

    if (
      event === "subscription.not_renew" ||
      event === "subscription.expiring_cards"
    ) {
      const { rows } = await req.db.query(
        `SELECT s.*, u.name, u.email, sp.display_name
         FROM subscriptions s
         JOIN users u ON u.id = s.user_id
         JOIN subscription_plans sp ON sp.id = s.plan_id
         WHERE s.paystack_sub_code = $1`,
        [data.subscription_code],
      );
      if (rows.length) {
        sendSubscriptionExpiredEmail(
          { name: rows[0].name, email: rows[0].email },
          { display_name: rows[0].display_name },
        ).catch(console.error);
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("[subscriptions/paystackWebhook]", err);
    return res.sendStatus(500);
  }
};

export const stripeSubscriptionWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    return res
      .status(400)
      .json({ error: `Stripe webhook error: ${err.message}` });
  }

  try {
    const data = event.data.object;

    if (event.type === "customer.subscription.updated") {
      const { rows } = await req.db.query(
        `SELECT * FROM subscriptions WHERE stripe_sub_id = $1`,
        [data.id],
      );
      if (rows.length) {
        const status =
          {
            active: "active",
            trialing: "trialing",
            past_due: "past_due",
            canceled: "cancelled",
            paused: "paused",
          }[data.status] || data.status;

        await req.db.query(
          `UPDATE subscriptions
           SET status = $1,
               current_period_start = to_timestamp($2),
               current_period_end   = to_timestamp($3),
               updated_at = now()
           WHERE stripe_sub_id = $4`,
          [status, data.current_period_start, data.current_period_end, data.id],
        );
      }
    }

    if (event.type === "invoice.payment_succeeded") {
      const subId = data.subscription;
      if (!subId) return res.sendStatus(200);

      const { rows } = await req.db.query(
        `SELECT s.*, u.name, u.email, sp.display_name
         FROM subscriptions s
         JOIN users u ON u.id = s.user_id
         JOIN subscription_plans sp ON sp.id = s.plan_id
         WHERE s.stripe_sub_id = $1`,
        [subId],
      );

      if (rows.length) {
        const sub = rows[0];
        const amount = data.amount_paid / 100;
        const currency = data.currency.toUpperCase();
        const periodStart = new Date(data.period_start * 1000);
        const periodEnd = new Date(data.period_end * 1000);

        await req.db.query(
          `UPDATE subscriptions
           SET bookings_used = 0, status = 'active', updated_at = now()
           WHERE stripe_sub_id = $1`,
          [subId],
        );

        await req.db.query(
          `INSERT INTO subscription_invoices
             (subscription_id, user_id, amount, currency, status, gateway,
              gateway_ref, period_start, period_end, paid_at)
           VALUES ($1,$2,$3,$4,'paid','stripe',$5,$6,$7,now())`,
          [
            sub.id,
            sub.user_id,
            amount,
            currency,
            data.payment_intent,
            periodStart,
            periodEnd,
          ],
        );

        await notify(req.db, {
          userId: sub.user_id,
          type: "payment_received",
          title: "Subscription renewed",
          body: `Your ${sub.display_name} subscription has been renewed.`,
          action_url: "/settings/subscription",
          sendMail: () =>
            sendSubscriptionRenewalEmail(
              { name: sub.name, email: sub.email },
              sub,
              {
                currency,
                amount,
                period_start: periodStart,
                period_end: periodEnd,
              },
            ),
        });
      }
    }

    if (event.type === "invoice.payment_failed") {
      const { rows } = await req.db.query(
        `SELECT s.*, u.name, u.email, sp.display_name
         FROM subscriptions s
         JOIN users u ON u.id = s.user_id
         JOIN subscription_plans sp ON sp.id = s.plan_id
         WHERE s.stripe_sub_id = $1`,
        [data.subscription],
      );
      if (rows.length) {
        const sub = rows[0];
        await req.db.query(
          `UPDATE subscriptions SET status = 'past_due' WHERE stripe_sub_id = $1`,
          [data.subscription],
        );

        await notify(req.db, {
          userId: sub.user_id,
          type: "payment_failed",
          title: "Subscription payment failed",
          body: "We couldn't renew your subscription. Please update your payment method.",
          priority: "high",
          action_url: "/settings/subscription",
          sendMail: () =>
            sendSubscriptionPaymentFailedEmail(
              { name: sub.name, email: sub.email },
              sub,
              {
                currency: data.currency.toUpperCase(),
                amount: data.amount_due / 100,
                failure_reason:
                  data.last_payment_error?.message || "Card declined",
              },
            ),
        });
      }
    }

    if (event.type === "customer.subscription.deleted") {
      await req.db.query(
        `UPDATE subscriptions
         SET status = 'cancelled', cancelled_at = now()
         WHERE stripe_sub_id = $1`,
        [data.id],
      );
      const { rows } = await req.db.query(
        `SELECT user_id FROM subscriptions WHERE stripe_sub_id = $1`,
        [data.id],
      );
      if (rows.length) {
        await req.db.query(
          `UPDATE users SET subscription_plan = 'free', subscription_badge = null
           WHERE id = $1`,
          [rows[0].user_id],
        );
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("[subscriptions/stripeWebhook]", err);
    return res.sendStatus(500);
  }
};

// ──────────────────────────────────────────────────────────────────────
//  ADMIN
// ──────────────────────────────────────────────────────────────────────

export const adminGetSubscriptions = async (req, res) => {
  const { status, plan_name, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`s.status = $${params.length}`);
  }
  if (plan_name) {
    params.push(plan_name);
    conditions.push(`sp.name = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT s.*,
              u.name as user_name, u.email as user_email, u.role as user_role,
              sp.display_name as plan_display_name, sp.name as plan_name,
              sp.prices, sp.badge
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       JOIN subscription_plans sp ON sp.id = s.plan_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const { rows: summary } = await req.db.query(`
      SELECT s.status, COUNT(*) as count,
             COALESCE(SUM(s.amount), 0) as mrr
      FROM subscriptions s
      WHERE s.status IN ('active','trialing')
      GROUP BY s.status
    `);

    return res.json({ subscriptions: rows, summary });
  } catch (err) {
    console.error("[subscriptions/adminGetSubscriptions]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const adminGrantSubscription = async (req, res) => {
  const { user_id, plan_id, months = 1, reason } = req.body;
  if (!user_id || !plan_id) {
    return res.status(400).json({ error: "user_id and plan_id are required" });
  }

  try {
    const plan = await getPlan(req.db, plan_id);
    if (!plan) return res.status(404).json({ error: "plan not found" });

    const { rows: userRows } = await req.db.query(
      `SELECT * FROM users WHERE id = $1`,
      [user_id],
    );
    if (!userRows.length)
      return res.status(404).json({ error: "user not found" });

    // Cancel existing
    await req.db.query(
      `UPDATE subscriptions
       SET status = 'cancelled', cancelled_at = now()
       WHERE user_id = $1 AND status IN ('active','trialing','paused')`,
      [user_id],
    );

    const now = new Date();
    const expiry = new Date(now);
    expiry.setMonth(expiry.getMonth() + Number(months));

    await req.db.query(
      `INSERT INTO subscriptions
         (user_id, plan_id, status, currency, amount, interval,
          current_period_start, current_period_end, gateway, auto_renew)
       VALUES ($1,$2,'active','NGN',0,'monthly',$3,$4,'manual',false)`,
      [user_id, plan.id, now, expiry],
    );

    await req.db.query(
      `UPDATE users SET subscription_plan = $1, subscription_badge = $2 WHERE id = $3`,
      [plan.name, plan.badge, user_id],
    );

    if (plan.name === "pro_badge") {
      await req.db.query(
        `UPDATE maid_profiles SET id_verified = true WHERE user_id = $1`,
        [user_id],
      );
    }

    await notify(req.db, {
      userId: user_id,
      type: "payment_received",
      title: `${plan.display_name} subscription granted`,
      body: `An admin has granted you a ${plan.display_name} subscription for ${months} month(s).${reason ? ` Reason: ${reason}` : ""}`,
      priority: "high",
      action_url: "/settings/subscription",
      sendMail: () =>
        sendSubscriptionConfirmationEmail(userRows[0], plan, {
          currency: "NGN",
          amount: 0,
          interval: "monthly",
          current_period_start: now,
          current_period_end: expiry,
        }),
    });

    return res.json({
      message: `${plan.display_name} granted for ${months} month(s)`,
    });
  } catch (err) {
    console.error("[subscriptions/adminGrantSubscription]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const adminManagePlans = async (req, res) => {
  const { action } = req.body; // 'create','update','toggle'

  try {
    if (action === "create") {
      const {
        name,
        display_name,
        description,
        target_role = "customer",
        plan_type = "recurring",
        interval = "monthly",
        prices,
        features,
        bookings_per_month,
        discount_percent = 0,
        priority_matching = false,
        dedicated_support = false,
        badge,
        trial_days = 0,
        sort_order = 0,
      } = req.body;

      if (!name || !display_name || !prices) {
        return res
          .status(400)
          .json({ error: "name, display_name and prices are required" });
      }

      const { rows } = await req.db.query(
        `INSERT INTO subscription_plans
           (name, display_name, description, target_role, plan_type, interval,
            prices, features, bookings_per_month, discount_percent,
            priority_matching, dedicated_support, badge, trial_days, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          name,
          display_name,
          description || null,
          target_role,
          plan_type,
          interval,
          JSON.stringify(prices),
          JSON.stringify(features || []),
          bookings_per_month || null,
          discount_percent,
          priority_matching,
          dedicated_support,
          badge || null,
          trial_days,
          sort_order,
        ],
      );
      return res.status(201).json({ plan: rows[0] });
    }

    if (action === "update") {
      const { plan_id, ...updates } = req.body;
      if (!plan_id) return res.status(400).json({ error: "plan_id required" });

      const allowed = [
        "display_name",
        "description",
        "prices",
        "features",
        "bookings_per_month",
        "discount_percent",
        "priority_matching",
        "dedicated_support",
        "badge",
        "trial_days",
        "sort_order",
        "is_featured",
      ];

      const fields = [];
      const params = [];

      for (const key of allowed) {
        if (updates[key] !== undefined) {
          params.push(
            typeof updates[key] === "object"
              ? JSON.stringify(updates[key])
              : updates[key],
          );
          fields.push(`${key} = $${params.length}`);
        }
      }

      if (!fields.length)
        return res.status(400).json({ error: "no fields to update" });
      params.push(plan_id);

      const { rows } = await req.db.query(
        `UPDATE subscription_plans SET ${fields.join(", ")}, updated_at = now()
         WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return res.json({ plan: rows[0] });
    }

    if (action === "toggle") {
      const { plan_id } = req.body;
      const { rows } = await req.db.query(
        `UPDATE subscription_plans SET is_active = NOT is_active, updated_at = now()
         WHERE id = $1 RETURNING id, name, is_active`,
        [plan_id],
      );
      return res.json({ plan: rows[0] });
    }

    return res
      .status(400)
      .json({ error: "action must be create, update, or toggle" });
  } catch (err) {
    console.error("[subscriptions/adminManagePlans]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const adminManagePromoCodes = async (req, res) => {
  const { action } = req.body;

  try {
    if (action === "create") {
      const {
        code,
        description,
        discount_type = "percent",
        discount_value,
        currency,
        max_uses,
        min_plan,
        valid_from,
        valid_until,
      } = req.body;

      if (!code || !discount_value) {
        return res
          .status(400)
          .json({ error: "code and discount_value are required" });
      }

      const { rows } = await req.db.query(
        `INSERT INTO promo_codes
           (code, description, discount_type, discount_value, currency,
            max_uses, min_plan, valid_from, valid_until, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          code.toUpperCase(),
          description || null,
          discount_type,
          discount_value,
          currency || null,
          max_uses || null,
          min_plan || null,
          valid_from || new Date(),
          valid_until || null,
          req.user.id,
        ],
      );
      return res.status(201).json({ promo: rows[0] });
    }

    if (action === "list") {
      const { rows } = await req.db.query(
        `SELECT * FROM promo_codes ORDER BY created_at DESC`,
      );
      return res.json({ promos: rows });
    }

    if (action === "toggle") {
      const { promo_id } = req.body;
      const { rows } = await req.db.query(
        `UPDATE promo_codes SET is_active = NOT is_active WHERE id = $1
         RETURNING id, code, is_active`,
        [promo_id],
      );
      return res.json({ promo: rows[0] });
    }

    return res
      .status(400)
      .json({ error: "action must be create, list, or toggle" });
  } catch (err) {
    console.error("[subscriptions/adminManagePromoCodes]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const getSubscriptionAnalytics = async (req, res) => {
  try {
    const [planBreakdown, mrr, churnRate, recentSignups, invoiceStats] =
      await Promise.all([
        req.db.query(`
        SELECT sp.display_name, sp.name, s.status,
               COUNT(*) as count,
               COALESCE(SUM(s.amount), 0) as total_revenue
        FROM subscriptions s
        JOIN subscription_plans sp ON sp.id = s.plan_id
        GROUP BY sp.display_name, sp.name, s.status
        ORDER BY count DESC
      `),
        req.db.query(`
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE status = 'active'), 0) as mrr,
          COALESCE(SUM(amount) FILTER (WHERE status = 'trialing'), 0) as trial_mrr,
          COUNT(*) FILTER (WHERE status = 'active') as active_count,
          COUNT(*) FILTER (WHERE status = 'trialing') as trial_count,
          COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_count,
          COUNT(*) FILTER (WHERE status = 'past_due') as past_due_count
        FROM subscriptions
      `),
        req.db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'cancelled' AND cancelled_at >= now() - INTERVAL '30 days') as churned_30d,
          COUNT(*) FILTER (WHERE status = 'active')   as active_total
        FROM subscriptions
      `),
        req.db.query(`
        SELECT DATE(s.created_at) as date, COUNT(*) as count,
               COALESCE(SUM(s.amount), 0) as revenue
        FROM subscriptions s
        WHERE s.created_at >= now() - INTERVAL '30 days'
          AND s.status IN ('active','trialing')
        GROUP BY DATE(s.created_at)
        ORDER BY date ASC
      `),
        req.db.query(`
        SELECT status, COUNT(*) as count,
               COALESCE(SUM(amount), 0) as total
        FROM subscription_invoices
        WHERE created_at >= now() - INTERVAL '30 days'
        GROUP BY status
      `),
      ]);

    const churn = churnRate.rows[0];
    const churnPercent =
      churn.active_total > 0
        ? ((churn.churned_30d / churn.active_total) * 100).toFixed(2)
        : 0;

    return res.json({
      plan_breakdown: planBreakdown.rows,
      mrr: mrr.rows[0],
      churn_rate_30d: `${churnPercent}%`,
      recent_signups: recentSignups.rows,
      invoice_stats: invoiceStats.rows,
    });
  } catch (err) {
    console.error("[subscriptions/getSubscriptionAnalytics]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
