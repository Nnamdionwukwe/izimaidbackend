import express from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  createCustomerSupportTicket,
  getCustomerSupportTickets,
  getCustomerSupportTicket,
  updateCustomerSupportTicket,
  replyCustomerSupportTicket,
  deleteCustomerSupportTicket,
  getCustomerSupportStats,
  uploadCustomerTicketMedia,
  deleteCustomerTicketMedia,
} from "../controllers/customer-support.controller.js";

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
  },
  fileFilter: (req, file, cb) => {
    const validImageTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ];
    const validVideoTypes = [
      "video/mp4",
      "video/quicktime",
      "video/x-msvideo",
      "video/x-ms-wmv",
    ];
    const allValidTypes = [...validImageTypes, ...validVideoTypes];

    if (allValidTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error("Invalid file type. Only images and videos are allowed."),
        false,
      );
    }
  },
});

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

// Get single customer support ticket with replies and attachments
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

// Upload media to customer support ticket
router.post(
  "/:id/media",
  requireAuth,
  upload.single("media"),
  uploadCustomerTicketMedia,
);

// Delete media from customer support ticket
router.delete(
  "/:ticketId/media/:attachmentId",
  requireAuth,
  deleteCustomerTicketMedia,
);

// Delete customer support ticket
router.delete("/:id", requireAuth, deleteCustomerSupportTicket);

export default router;
