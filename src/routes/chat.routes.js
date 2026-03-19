import express from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  getOrCreateConversation,
  sendMessage,
  sendMediaMessage,
  markMessagesRead,
  getMyConversations,
  getUnreadCount,
  deleteMessage,
  deleteConversation,
  adminGetAllConversations,
  adminGetConversation,
} from "../controllers/chat.controller.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const valid = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/quicktime",
      "video/x-msvideo",
      "video/x-ms-wmv",
    ];
    if (valid.includes(file.mimetype)) cb(null, true);
    else
      cb(
        new Error("Invalid file type. Only images and videos are allowed."),
        false,
      );
  },
});

// ═══════════════════════════════════════════════════════════════════════
//  ADMIN-ONLY ROUTES  (read-only — admin cannot send or delete messages)
// ═══════════════════════════════════════════════════════════════════════

// GET /api/chat/admin
//   List all conversations across all users, with search + pagination
//   Query params: ?page=1&limit=20&search=name_or_bookingId
router.get(
  "/admin",
  requireAuth,
  requireRole("admin"),
  adminGetAllConversations,
);

// GET /api/chat/admin/:conversationId
//   Read a single conversation with full message history
//   Admin view — does NOT affect unread counters for customer or maid
router.get(
  "/admin/:conversationId",
  requireAuth,
  requireRole("admin"),
  adminGetConversation,
);

// ═══════════════════════════════════════════════════════════════════════
//  CUSTOMER & MAID ROUTES
// ═══════════════════════════════════════════════════════════════════════

// GET /api/chat
//   Inbox — all conversations for the logged-in user
router.get("/", requireAuth, getMyConversations);

// GET /api/chat/unread
//   Total unread message count (for nav badge)
router.get("/unread", requireAuth, getUnreadCount);

// GET /api/chat/booking/:bookingId
//   Get or create the conversation for a booking, plus all messages
router.get("/booking/:bookingId", requireAuth, getOrCreateConversation);

// POST /api/chat/:conversationId/messages
//   Send a text message
router.post("/:conversationId/messages", requireAuth, sendMessage);

// POST /api/chat/:conversationId/messages/media
//   Send an image or video
router.post(
  "/:conversationId/messages/media",
  requireAuth,
  upload.single("media"),
  sendMediaMessage,
);

// PATCH /api/chat/:conversationId/read
//   Mark all incoming messages in this conversation as read
router.patch("/:conversationId/read", requireAuth, markMessagesRead);

// DELETE /api/chat/messages/:messageId  ← MUST come before /:conversationId
//   Delete own message (within 5 minutes of sending)
//   NOTE: specific routes must be registered before wildcard routes in Express
router.delete("/messages/:messageId", requireAuth, deleteMessage);

// DELETE /api/chat/:conversationId
//   Soft-delete a conversation for the current user only (customer or maid)
//   Admin cannot use this — their view is never affected
router.delete("/:conversationId", requireAuth, deleteConversation);

export default router;
