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
  getOrCreateInquiry,
  getMaidInquiry,
} from "../controllers/chat.controller.js";

import db from "../config/database.js";

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

router.get("/:conversationId/messages", requireAuth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    const { rows: conv } = await req.db.query(
      // ← req.db not db
      `SELECT * FROM conversations WHERE id = $1`,
      [conversationId],
    );
    if (!conv.length) return res.status(404).json({ error: "not found" });

    const c = conv[0];
    if (
      c.customer_id !== userId &&
      c.maid_id !== userId &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({ error: "forbidden" });
    }

    const { rows: messages } = await req.db.query(
      // ← req.db not db
      `SELECT m.*,
              u.name   AS sender_name,
              u.role   AS sender_role,
              u.avatar AS sender_avatar,
              CASE WHEN m.deleted_at IS NOT NULL THEN 'deleted' ELSE m.content END AS content,
              CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE m.media_url END AS media_url
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversationId],
    );

    // Mark read
    await req.db.query(
      `UPDATE messages SET is_read = true
       WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false`,
      [conversationId, userId],
    );

    const isCustomer = userId === c.customer_id;
    await req.db.query(
      `UPDATE conversations SET ${isCustomer ? "unread_customer = 0" : "unread_maid = 0"} WHERE id = $1`,
      [conversationId],
    );

    return res.json({ conversation: c, messages });
  } catch (err) {
    console.error("[chat/:id/messages]", err);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chat/:conversationId
//   Soft-delete a conversation for the current user only (customer or maid)
//   Admin cannot use this — their view is never affected
router.delete("/:conversationId", requireAuth, deleteConversation);

router.get(
  "/inquiry/:maidId",
  requireAuth,
  requireRole("customer"),
  getOrCreateInquiry,
);

// Add this below the existing customer inquiry route
router.get(
  "/inquiry/customer/:customerId",
  requireAuth,
  requireRole("maid"),
  getMaidInquiry,
);

export default router;
