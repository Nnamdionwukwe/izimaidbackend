// src/routes/contact.routes.js
import { Router } from "express";
import {
  createContactMessage,
  listMessages,
  getMessage,
  updateMessageStatus,
  updateAdminNotes,
  deleteMessage,
  getMessageStats,
  bulkUpdateStatus,
} from "../controllers/contact.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// ─────────────────────────────────────────────────────────────
// PUBLIC ROUTES (No authentication required)
// ─────────────────────────────────────────────────────────────
router.post("/messages", createContactMessage);

// ─────────────────────────────────────────────────────────────
// ADMIN ROUTES (Authentication + Admin role required)
// ─────────────────────────────────────────────────────────────
router.get("/messages", requireAuth, requireRole("admin"), listMessages);

router.get(
  "/messages/stats",
  requireAuth,
  requireRole("admin"),
  getMessageStats,
);

router.get("/messages/:id", requireAuth, requireRole("admin"), getMessage);

router.patch(
  "/messages/:id/status",
  requireAuth,
  requireRole("admin"),
  updateMessageStatus,
);

router.patch(
  "/messages/:id/notes",
  requireAuth,
  requireRole("admin"),
  updateAdminNotes,
);

router.delete(
  "/messages/:id",
  requireAuth,
  requireRole("admin"),
  deleteMessage,
);

router.post(
  "/messages/bulk/status",
  requireAuth,
  requireRole("admin"),
  bulkUpdateStatus,
);

export default router;
