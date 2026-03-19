import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  initializePayment,
  verifyPayment,
  webhook,
  getPayment,
  adminApproveBooking,
  adminRejectBooking,
  listPendingPayments,
} from "../controllers/payments.js";

const router = Router();

// Customer
router.post("/initialize", requireAuth, initializePayment);
router.get("/verify/:reference", requireAuth, verifyPayment);
router.get("/booking/:booking_id", requireAuth, getPayment);

// Paystack webhook (no auth — verified by signature)
router.post("/webhook", webhook);

// Admin
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

export default router;
