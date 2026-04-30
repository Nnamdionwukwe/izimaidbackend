import express from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  getOrCreateMaidSupportConversation,
  sendMaidSupportMessage,
  sendMaidSupportMediaMessage,
  markMaidSupportMessagesRead,
  getMyMaidSupportConversations,
  getMaidSupportUnreadCount,
  deleteMaidSupportMessage,
  deleteMaidSupportConversation,
  adminGetAllMaidSupportConversations,
  adminGetMaidSupportConversation,
} from "../controllers/maid-admin-livechat.controller.js";

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

// GET /api/maid-support-chat/admin
//   List all maid support conversations with search + pagination
//   Query params: ?page=1&limit=20&search=maidName_or_email
router.get(
  "/admin",
  requireAuth,
  requireRole("admin"),
  adminGetAllMaidSupportConversations,
);

// GET /api/maid-support-chat/admin/:conversationId
//   Read a single maid support conversation — admin sees all messages including deleted
//   Does NOT affect maid's unread counter
router.get(
  "/admin/:conversationId",
  requireAuth,
  requireRole("admin"),
  adminGetMaidSupportConversation,
);

// ═══════════════════════════════════════════════════════════════════════
//  STATIC-SEGMENT ROUTES
//  Must come before /:conversationId to prevent Express matching
//  literal words ("unread", "messages", "conversation") as a param.
// ═══════════════════════════════════════════════════════════════════════

// GET /api/maid-support-chat
//   Inbox — maid sees their own thread; admin sees all threads
router.get("/", requireAuth, getMyMaidSupportConversations);

// GET /api/maid-support-chat/unread
//   Total unread count (maid: their thread; admin: sum across all threads)
router.get("/unread", requireAuth, getMaidSupportUnreadCount);

// GET /api/maid-support-chat/conversation
//   Get or create the support conversation for the logged-in maid
//   Admin can pass ?maidId=<uuid> to look up a specific maid's thread
router.get("/conversation", requireAuth, getOrCreateMaidSupportConversation);

// DELETE /api/maid-support-chat/messages/:messageId
//   Soft-delete own message within 5 minutes of sending
//   MUST be registered before /:conversationId
router.delete("/messages/:messageId", requireAuth, deleteMaidSupportMessage);

// ═══════════════════════════════════════════════════════════════════════
//  PARAM ROUTES  (/:conversationId)
//  Registered last — only fire when no static route above matched.
// ═══════════════════════════════════════════════════════════════════════

// POST /api/maid-support-chat/:conversationId/messages
//   Send a text message (maid or admin)
router.post("/:conversationId/messages", requireAuth, sendMaidSupportMessage);

// POST /api/maid-support-chat/:conversationId/messages/media
//   Send an image or video (maid or admin)
router.post(
  "/:conversationId/messages/media",
  requireAuth,
  upload.single("media"),
  sendMaidSupportMediaMessage,
);

// PATCH /api/maid-support-chat/:conversationId/read
//   Mark all incoming messages in this conversation as read
router.patch("/:conversationId/read", requireAuth, markMaidSupportMessagesRead);

// DELETE /api/maid-support-chat/:conversationId
//   Soft-delete the conversation from maid's inbox (maid only)
//   Admin cannot use this endpoint
router.delete("/:conversationId", requireAuth, deleteMaidSupportConversation);

export default router;
