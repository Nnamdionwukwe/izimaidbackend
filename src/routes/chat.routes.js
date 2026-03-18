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
//  ADMIN-ONLY ROUTES
//  These must come before /:conversationId so Express doesn't swallow
//  the literal segment "admin" as a conversationId value.
// ═══════════════════════════════════════════════════════════════════════

// GET /api/chat/admin
router.get(
  "/admin",
  requireAuth,
  requireRole("admin"),
  adminGetAllConversations,
);

// GET /api/chat/admin/:conversationId
router.get(
  "/admin/:conversationId",
  requireAuth,
  requireRole("admin"),
  adminGetConversation,
);

// ═══════════════════════════════════════════════════════════════════════
//  STATIC-SEGMENT ROUTES
//  Must come before /:conversationId — otherwise Express treats the
//  literal word "unread", "booking", or "messages" as a conversationId.
// ═══════════════════════════════════════════════════════════════════════

// GET /api/chat
router.get("/", requireAuth, getMyConversations);

// GET /api/chat/unread  ← must be above /:conversationId
router.get("/unread", requireAuth, getUnreadCount);

// GET /api/chat/booking/:bookingId  ← must be above /:conversationId
router.get("/booking/:bookingId", requireAuth, getOrCreateConversation);

// DELETE /api/chat/messages/:messageId  ← must be above /:conversationId
router.delete("/messages/:messageId", requireAuth, deleteMessage);

// ═══════════════════════════════════════════════════════════════════════
//  PARAM ROUTES  (/:conversationId)
//  These come last so static segments above are never shadowed.
// ═══════════════════════════════════════════════════════════════════════

// POST /api/chat/:conversationId/messages
router.post("/:conversationId/messages", requireAuth, sendMessage);

// POST /api/chat/:conversationId/messages/media
router.post(
  "/:conversationId/messages/media",
  requireAuth,
  upload.single("media"),
  sendMediaMessage,
);

// PATCH /api/chat/:conversationId/read
router.patch("/:conversationId/read", requireAuth, markMessagesRead);

export default router;
