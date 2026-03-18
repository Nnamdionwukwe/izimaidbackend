import express from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  createCustomerSupportTicket,
  getCustomerSupportTickets,
  getCustomerSupportTicket,
  updateCustomerSupportTicket,
  replyCustomerSupportTicket,
  deleteCustomerSupportTicket,
  getCustomerSupportStats,
} from "../controllers/customer-support.controller.js";

const router = express.Router();

// Create a new customer support ticket (authenticated users)
router.post("/", requireAuth, createCustomerSupportTicket);

// Get customer support tickets (authenticated users - see own, admins see all)
router.get("/", requireAuth, getCustomerSupportTickets);

// Get customer support statistics (admin only)
router.get(
  "/stats",
  requireAuth,
  requireRole("admin"),
  getCustomerSupportStats,
);

// Get single customer support ticket with replies
router.get("/:id", requireAuth, getCustomerSupportTicket);

// Update customer support ticket status (admin only)
router.patch(
  "/:id",
  requireAuth,
  requireRole("admin"),
  updateCustomerSupportTicket,
);

// Add reply to customer support ticket
router.post("/:id/reply", requireAuth, replyCustomerSupportTicket);

// Delete customer support ticket
router.delete("/:id", requireAuth, deleteCustomerSupportTicket);

export default router;
