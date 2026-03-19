import express from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  getOrCreateSupportConversation,
  sendSupportMessage,
  sendSupportMediaMessage,
  markSupportMessagesRead,
  getMySupportConversations,
  getSupportUnreadCount,
  deleteSupportMessage,
  deleteSupportConversation,
  adminGetAllSupportConversations,
  adminGetSupportConversation,
} from "../controllers/support-chat.controller.js";

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
//  ADMIN-ONLY ROUTES
//  Registered first — must come before /:conversationId so Express
//  never swallows the literal segment "admin" as a param value.
// ═══════════════════════════════════════════════════════════════════════

// GET /api/support-chat/admin
//   List all customer support conversations with search + pagination
//   Query params: ?page=1&limit=20&search=customerName_or_email
router.get(
  "/admin",
  requireAuth,
  requireRole("admin"),
  adminGetAllSupportConversations,
);

// GET /api/support-chat/admin/:conversationId
//   Read a single support conversation — admin sees all messages including deleted
//   Does NOT affect customer's unread counter
router.get(
  "/admin/:conversationId",
  requireAuth,
  requireRole("admin"),
  adminGetSupportConversation,
);

// ═══════════════════════════════════════════════════════════════════════
//  STATIC-SEGMENT ROUTES
//  Must come before /:conversationId to prevent Express matching
//  literal words ("unread", "messages") as a conversationId value.
// ═══════════════════════════════════════════════════════════════════════

// GET /api/support-chat
//   Inbox — customer sees their own thread; admin sees all threads
router.get("/", requireAuth, getMySupportConversations);

// GET /api/support-chat/unread
//   Total unread count (customer: their thread; admin: sum across all threads)
router.get("/unread", requireAuth, getSupportUnreadCount);

// GET /api/support-chat/conversation
//   Get or create the support conversation for the logged-in customer
//   Admin can pass ?customerId=<uuid> to look up a specific customer's thread
router.get("/conversation", requireAuth, getOrCreateSupportConversation);

// DELETE /api/support-chat/messages/:messageId
//   Soft-delete own message within 5 minutes of sending
//   MUST be registered before /:conversationId
router.delete("/messages/:messageId", requireAuth, deleteSupportMessage);

// ═══════════════════════════════════════════════════════════════════════
//  PARAM ROUTES  (/:conversationId)
//  Registered last — only fire when no static route above matched.
// ═══════════════════════════════════════════════════════════════════════

// POST /api/support-chat/:conversationId/messages
//   Send a text message (customer or admin)
router.post("/:conversationId/messages", requireAuth, sendSupportMessage);

// POST /api/support-chat/:conversationId/messages/media
//   Send an image or video (customer or admin)
router.post(
  "/:conversationId/messages/media",
  requireAuth,
  upload.single("media"),
  sendSupportMediaMessage,
);

// PATCH /api/support-chat/:conversationId/read
//   Mark all incoming messages in this conversation as read
router.patch("/:conversationId/read", requireAuth, markSupportMessagesRead);

// DELETE /api/support-chat/:conversationId
//   Soft-delete the conversation from customer's inbox (customer only)
//   Admin cannot use this endpoint
router.delete("/:conversationId", requireAuth, deleteSupportConversation);

export default router;
