import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import express from "express";
import {
  getPlans,
  getMySubscription,
  validatePromo,
  subscribeFlutterwave, // ← Flutterwave only
  verifySubscriptionPayment, // ← supports Flutterwave
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
  changePlan,
  flutterwaveSubscriptionWebhook, // ← Flutterwave webhook
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
router.post("/subscribe", requireAuth, subscribeFlutterwave); // ← only Flutterwave
router.get("/verify", requireAuth, verifySubscriptionPayment); // works for Flutterwave
router.post("/cancel", requireAuth, cancelSubscription);
router.post("/pause", requireAuth, pauseSubscription);
router.post("/resume", requireAuth, resumeSubscription);
router.post("/change-plan", requireAuth, changePlan);

// ── Webhook (no auth – verified by signature) ──────────────────────
router.post(
  "/webhook/flutterwave",
  express.raw({ type: "application/json" }),
  flutterwaveSubscriptionWebhook,
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
