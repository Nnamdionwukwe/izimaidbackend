import { Router } from "express";
import {
  createCertificate,
  verifyCertificatePayment,
  webhook, // ← Flutterwave webhook
  redeemCertificate,
  verifyCertificate,
  listCertificates,
  getCertificate,
  updateCertificateStatus,
  updateAdminNotes,
  deleteCertificate,
  getCertificateStats,
  bulkUpdateStatus,
} from "../controllers/giftCertificate.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// ─────────────────────────────────────────────────────────────
// PUBLIC ROUTES (No authentication required)
// ─────────────────────────────────────────────────────────────
router.post("/certificates", createCertificate);
router.get("/certificates/verify", verifyCertificatePayment);
router.get("/certificates/check", verifyCertificate);
router.post("/certificates/redeem", redeemCertificate);

// ─────────────────────────────────────────────────────────────
// WEBHOOK (No authentication – verified by signature)
// ─────────────────────────────────────────────────────────────
router.post("/webhook/flutterwave", webhook);

// ─────────────────────────────────────────────────────────────
// ADMIN ROUTES (Authentication + Admin role required)
// ─────────────────────────────────────────────────────────────
router.get(
  "/certificates",
  requireAuth,
  requireRole("admin"),
  listCertificates,
);

router.get(
  "/certificates/stats",
  requireAuth,
  requireRole("admin"),
  getCertificateStats,
);

router.get(
  "/certificates/:id",
  requireAuth,
  requireRole("admin"),
  getCertificate,
);

router.patch(
  "/certificates/:id/status",
  requireAuth,
  requireRole("admin"),
  updateCertificateStatus,
);

router.patch(
  "/certificates/:id/notes",
  requireAuth,
  requireRole("admin"),
  updateAdminNotes,
);

router.delete(
  "/certificates/:id",
  requireAuth,
  requireRole("admin"),
  deleteCertificate,
);

router.post(
  "/certificates/bulk/status",
  requireAuth,
  requireRole("admin"),
  bulkUpdateStatus,
);

export default router;
