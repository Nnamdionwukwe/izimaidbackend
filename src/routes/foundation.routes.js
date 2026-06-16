// src/routes/foundation.routes.js
import { Router } from "express";
import {
  createDonation,
  verifyDonationPayment,
  listDonations,
  getDonation,
  updateDonationStatus,
  updateAdminNotes,
  deleteDonation,
  getDonationStats,
  bulkUpdateStatus,
} from "../controllers/foundation.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// ─────────────────────────────────────────────────────────────
// PUBLIC ROUTES (No authentication required)
// ─────────────────────────────────────────────────────────────
router.post("/donations", createDonation);
router.get("/donations/verify", verifyDonationPayment);

// ─────────────────────────────────────────────────────────────
// ADMIN ROUTES (Authentication + Admin role required)
// ─────────────────────────────────────────────────────────────
router.get("/donations", requireAuth, requireRole("admin"), listDonations);

router.get(
  "/donations/stats",
  requireAuth,
  requireRole("admin"),
  getDonationStats,
);

router.get("/donations/:id", requireAuth, requireRole("admin"), getDonation);

router.patch(
  "/donations/:id/status",
  requireAuth,
  requireRole("admin"),
  updateDonationStatus,
);

router.patch(
  "/donations/:id/notes",
  requireAuth,
  requireRole("admin"),
  updateAdminNotes,
);

router.delete(
  "/donations/:id",
  requireAuth,
  requireRole("admin"),
  deleteDonation,
);

router.post(
  "/donations/bulk/status",
  requireAuth,
  requireRole("admin"),
  bulkUpdateStatus,
);

export default router;
