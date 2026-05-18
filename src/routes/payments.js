// src/routes/payment.routes.js
// Routes match EXACTLY what the website frontend calls.

import express, { Router } from "express";
import { protect, requireRole } from "../middleware/auth.middleware.js";
import {
  initializePayment, // POST /initialize          (Paystack)
  initializeStripePayment, // POST /initialize/stripe   (Stripe Checkout)
  initializeBankTransfer, // POST /initialize/bank
  initializeCryptoPayment, // POST /initialize/crypto
  verifyPayment, // GET  /verify
  getPayment, // GET  /booking/:booking_id
  stripeWebhook, // POST /webhook/stripe
  paystackWebhook, // POST /webhook
} from "../controllers/payment.controller.js";

const router = Router();

// ── Paystack Stripe Bank Crypto init ─────────────────────────────────────────
router.post("/initialize", protect, requireRole("HIRER"), initializePayment);
router.post(
  "/initialize/stripe",
  protect,
  requireRole("HIRER"),
  initializeStripePayment,
);
router.post(
  "/initialize/bank",
  protect,
  requireRole("HIRER"),
  initializeBankTransfer,
);
router.post(
  "/initialize/crypto",
  protect,
  requireRole("HIRER"),
  initializeCryptoPayment,
);

// ── Verify after redirect ─────────────────────────────────────────────────────
// ?gateway=stripe&session_id=xxx  OR  ?reference=xxx  (Paystack)
router.get("/verify", protect, verifyPayment);

// PaystackVerify.jsx calls /verify/paystack — add as alias
router.get("/verify/paystack", protect, verifyPayment);

// ── Get payment for a booking ─────────────────────────────────────────────────
router.get("/booking/:booking_id", protect, getPayment);

// ── Webhooks — NO auth, verified by signature ─────────────────────────────────
// Stripe webhook MUST receive raw body — register before express.json() in server.js
router.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhook,
);
router.post("/webhook", paystackWebhook);

export default router;
