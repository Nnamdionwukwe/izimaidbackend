// src/routes/subscriptions.routes.js
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import express from "express";
import {
  getPlans,
  getMySubscription,
  validatePromo,
  subscribePaystack,
  subscribeStripe,
  verifySubscriptionPayment,
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
  changePlan,
  paystackSubscriptionWebhook,
  stripeSubscriptionWebhook,
  adminGetSubscriptions,
  adminGrantSubscription,
  adminManagePlans,
  adminManagePromoCodes,
  getSubscriptionAnalytics,
  adminUpdateSubscription,
} from "../controllers/subscriptions.controller.js";

const router = Router();

// ── Public ────────────────────────────────────────────────────────────
router.get("/plans", getPlans);
router.post("/validate-promo", validatePromo);

// ── Authenticated user ────────────────────────────────────────────────
router.get("/my", requireAuth, getMySubscription);
router.post("/subscribe/paystack", requireAuth, subscribePaystack);
router.post("/subscribe/stripe", requireAuth, subscribeStripe);
router.get("/verify", requireAuth, verifySubscriptionPayment);
router.post("/cancel", requireAuth, cancelSubscription);
router.post("/pause", requireAuth, pauseSubscription);
router.post("/resume", requireAuth, resumeSubscription);
router.post("/change-plan", requireAuth, changePlan);

// ── Webhooks (no auth — verified by signature) ────────────────────────
router.post("/webhook/paystack", paystackSubscriptionWebhook);
router.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  stripeSubscriptionWebhook,
);

// ── Admin ─────────────────────────────────────────────────────────────
const admin = [requireAuth, requireRole("admin")];
router.patch("/admin/:id", ...admin, adminUpdateSubscription);
router.get("/admin", ...admin, adminGetSubscriptions);
router.get("/admin/analytics", ...admin, getSubscriptionAnalytics);
router.post("/admin/grant", ...admin, adminGrantSubscription);
router.post("/admin/plans", ...admin, adminManagePlans);
router.post("/admin/promo-codes", ...admin, adminManagePromoCodes);

export default router;
