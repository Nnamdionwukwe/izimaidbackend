import express from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  createMaidSupportTicket,
  getMaidSupportTickets,
  getMaidSupportTicket,
  updateMaidSupportTicket,
  replyMaidSupportTicket,
  deleteMaidSupportTicket,
  getMaidSupportStats,
} from "../controllers/maid-support.controller.js";

const router = express.Router();

// Create a new maid support ticket (authenticated maids)
router.post("/", requireAuth, requireRole("maid"), createMaidSupportTicket);

// Get maid support tickets (maids see own, admins see all)
router.get("/", requireAuth, getMaidSupportTickets);

// Get maid support statistics (admin only)
router.get("/stats", requireAuth, requireRole("admin"), getMaidSupportStats);

// Get single maid support ticket with replies
router.get("/:id", requireAuth, getMaidSupportTicket);

// Update maid support ticket status (admin only)
router.patch(
  "/:id",
  requireAuth,
  requireRole("admin"),
  updateMaidSupportTicket,
);

// Add reply to maid support ticket
router.post("/:id/reply", requireAuth, replyMaidSupportTicket);

// Delete maid support ticket
router.delete("/:id", requireAuth, deleteMaidSupportTicket);

export default router;
