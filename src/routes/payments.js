import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import express from "express";
import {
  initializePayment, // Flutterwave
  initializeBankTransfer,
  confirmBankTransfer,
  initializeCryptoPayment,
  confirmCryptoPayment, // 👈 NEW – user submits TX hash + proof
  adminVerifyCryptoPayment, // 👈 NEW – admin verifies crypto payment
  verifyPayment,
  flutterwaveWebhook,
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
  adminListBankTransfers,
  adminListCryptoPayments,
} from "../controllers/payments.js";

const router = Router();

// ── Customer payments ─────────────────────────────────────────────────
router.post("/initialize", requireAuth, initializePayment); // Flutterwave
router.post("/initialize/bank", requireAuth, initializeBankTransfer);
router.post("/confirm/bank", requireAuth, confirmBankTransfer);
router.post("/initialize/crypto", requireAuth, initializeCryptoPayment);
router.post("/confirm/crypto", requireAuth, confirmCryptoPayment); // 👈 NEW
router.get("/my", requireAuth, listCustomerPayments);

router.get("/verify", requireAuth, verifyPayment); // ?gateway=flutterwave&reference=x
router.get("/booking/:booking_id", requireAuth, getPayment);

// ── Maid ──────────────────────────────────────────────────────────────
router.get("/earnings", requireAuth, requireRole("maid"), getMaidEarnings);
router.get(
  "/bank-details",
  requireAuth,
  requireRole("maid"),
  getMaidBankDetails,
);
router.get("/maid/earnings", requireAuth, requireRole("maid"), getMaidEarnings);
router.post(
  "/bank-details",
  requireAuth,
  requireRole("maid"),
  saveMaidBankDetails,
);

// ── Webhook (no auth – verified by signature) ──────────────────────
router.post(
  "/webhook/flutterwave",
  express.raw({ type: "application/json" }),
  flutterwaveWebhook,
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
router.get(
  "/bank-transfers",
  requireAuth,
  requireRole("admin"),
  adminListBankTransfers,
);
router.get(
  "/crypto",
  requireAuth,
  requireRole("admin"),
  adminListCryptoPayments,
);
router.patch(
  "/crypto/:payment_id/verify", // 👈 NEW
  requireAuth,
  requireRole("admin"),
  adminVerifyCryptoPayment,
);

export default router;
