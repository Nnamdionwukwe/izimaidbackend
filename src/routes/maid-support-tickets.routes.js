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
  getMaidSupportUnreadCount,
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
router.get("/", requireAuth, getMaidSupportTickets);

// ── Specific routes BEFORE /:id ──────────────────────────────────────
router.get("/stats", requireAuth, requireRole("admin"), getMaidSupportStats);
router.get("/unread-count", requireAuth, getMaidSupportUnreadCount); // ← ADD HERE

// ── Wildcard /:id routes AFTER ───────────────────────────────────────
router.get("/:id", requireAuth, getMaidSupportTicket);
router.patch(
  "/:id",
  requireAuth,
  requireRole("admin"),
  updateMaidSupportTicket,
);
router.post("/:id/reply", requireAuth, replyMaidSupportTicket);
router.post(
  "/:id/media",
  requireAuth,
  upload.single("media"),
  uploadMaidTicketMedia,
);
router.delete(
  "/:ticketId/media/:attachmentId",
  requireAuth,
  deleteMaidTicketMedia,
);
router.delete("/:id", requireAuth, deleteMaidSupportTicket);
export default router;
