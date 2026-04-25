import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import express from "express";
// REPLACE the entire import block — remove the duplicate getMaidEarnings:
import {
  initializePayment,
  initializeStripePayment,
  initializeBankTransfer,
  confirmBankTransfer,
  initializeCryptoPayment,
  verifyPayment,
  webhook,
  stripeWebhook,
  getPayment,
  getMaidEarnings,
  saveMaidBankDetails,
  getMaidBankDetails,
  adminApproveBooking,
  adminRejectBooking,
  adminVerifyBankTransfer,
  adminProcessPayout,
  adminListPayouts,
  listPendingPayments,
  listCustomerPayments,
} from "../controllers/payments.js";

const router = Router();

// ── Customer payments ─────────────────────────────────────────────────
router.post("/initialize", requireAuth, initializePayment); // Paystack
router.post("/initialize/stripe", requireAuth, initializeStripePayment); // Stripe
router.post("/initialize/bank", requireAuth, initializeBankTransfer); // Bank transfer
router.post("/confirm/bank", requireAuth, confirmBankTransfer); // Upload proof
router.post("/initialize/crypto", requireAuth, initializeCryptoPayment); // Crypto
router.get("/my", requireAuth, listCustomerPayments);

router.get("/verify", requireAuth, verifyPayment); // ?gateway=paystack&reference=x OR ?gateway=stripe&session_id=x
router.get("/booking/:booking_id", requireAuth, getPayment);

// ── Maid ──────────────────────────────────────────────────────────────
router.get("/earnings", requireAuth, requireRole("maid"), getMaidEarnings);
router.get(
  "/bank-details",
  requireAuth,
  requireRole("maid"),
  getMaidBankDetails,
);
// Add this line with your other maid routes:
router.get("/maid/earnings", requireAuth, requireRole("maid"), getMaidEarnings);
router.post(
  "/bank-details",
  requireAuth,
  requireRole("maid"),
  saveMaidBankDetails,
);

// ── Webhooks (no auth — verified by signature) ────────────────────────
router.post("/webhook", webhook);
// Stripe needs raw body — must be registered with express.raw middleware in server.js
router.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhook,
);

// ── Admin ─────────────────────────────────────────────────────────────
router.get("/pending", requireAuth, requireRole("admin"), listPendingPayments);
router.post(
  "/approve/:booking_id",
  requireAuth,
  requireRole("admin"),
  adminApproveBooking,
);
router.post(
  "/reject/:booking_id",
  requireAuth,
  requireRole("admin"),
  adminRejectBooking,
);
router.patch(
  "/bank-transfer/:payment_id",
  requireAuth,
  requireRole("admin"),
  adminVerifyBankTransfer,
);
router.get("/payouts", requireAuth, requireRole("admin"), adminListPayouts);
router.patch(
  "/payouts/:payout_id/process",
  requireAuth,
  requireRole("admin"),
  adminProcessPayout,
);

export default router;
