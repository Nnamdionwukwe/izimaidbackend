import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  initializePayment,
  verifyPayment,
  webhook,
  getPayment,
} from "../controllers/payments.js";

const router = Router();

router.post(
  "/initialize",
  requireAuth,
  requireRole("customer"),
  initializePayment,
);
router.get("/verify/:reference", requireAuth, verifyPayment);
router.post("/webhook", webhook);
router.get("/booking/:booking_id", requireAuth, getPayment);

export default router;
