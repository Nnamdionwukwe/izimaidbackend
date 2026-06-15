// src/routes/housekeeperTraining.routes.js
import { Router } from "express";
import {
  createApplication,
  listApplications,
  getApplication,
  updateApplicationStatus,
  updateAdminNotes,
  deleteApplication,
  getApplicationStats,
  bulkUpdateStatus,
} from "../controllers/housekeeperTraining.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// ─────────────────────────────────────────────────────────────
// PUBLIC ROUTES (No authentication required)
// ─────────────────────────────────────────────────────────────
router.post("/applications", createApplication);

// ─────────────────────────────────────────────────────────────
// ADMIN ROUTES (Authentication + Admin role required)
// ─────────────────────────────────────────────────────────────
router.get(
  "/applications",
  requireAuth,
  requireRole("admin"),
  listApplications,
);

router.get(
  "/applications/stats",
  requireAuth,
  requireRole("admin"),
  getApplicationStats,
);

router.get(
  "/applications/:id",
  requireAuth,
  requireRole("admin"),
  getApplication,
);

router.patch(
  "/applications/:id/status",
  requireAuth,
  requireRole("admin"),
  updateApplicationStatus,
);

router.patch(
  "/applications/:id/notes",
  requireAuth,
  requireRole("admin"),
  updateAdminNotes,
);

router.delete(
  "/applications/:id",
  requireAuth,
  requireRole("admin"),
  deleteApplication,
);

router.post(
  "/applications/bulk/status",
  requireAuth,
  requireRole("admin"),
  bulkUpdateStatus,
);

export default router;
