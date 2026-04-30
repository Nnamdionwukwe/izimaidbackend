import express from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  createMaidSupportTicket,
  getMaidSupportTickets,
  getMaidSupportTicket,
  updateMaidSupportTicket,
  replyMaidSupportTicket,
  deleteMaidSupportTicket,
  getMaidSupportStats,
  uploadMaidTicketMedia,
  deleteMaidTicketMedia,
} from "../controllers/maid-support-tickets.controller.js";

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

// Create a new maid support ticket (authenticated maids)
router.post("/", requireAuth, requireRole("maid"), createMaidSupportTicket);

// Get maid support tickets (maids see own, admins see all)
router.get("/", requireAuth, getMaidSupportTickets);

// Get maid support statistics (admin only)
router.get("/stats", requireAuth, requireRole("admin"), getMaidSupportStats);

// Get single maid support ticket with replies and attachments
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

// Upload media to maid support ticket
router.post(
  "/:id/media",
  requireAuth,
  upload.single("media"),
  uploadMaidTicketMedia,
);

// Delete media from maid support ticket
router.delete(
  "/:ticketId/media/:attachmentId",
  requireAuth,
  deleteMaidTicketMedia,
);

// Delete maid support ticket
router.delete("/:id", requireAuth, deleteMaidSupportTicket);

export default router;
