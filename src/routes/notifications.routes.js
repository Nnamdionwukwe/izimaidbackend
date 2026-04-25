// src/routes/notifications.routes.js
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  markTypeAsRead,
  deleteNotification,
  deleteAllRead,
  getPreferences,
  updatePreferences,
  registerPushToken,
  deregisterPushToken,
  adminSendAnnouncement,
  adminSendToUser,
  adminGetNotifications,
  adminCleanupNotifications,
} from "../controllers/notifications.controller.js";

const router = Router();

router.get("/test-email", async (req, res) => {
  const { transporter } = await import("../utils/mailer.js");
  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.SMTP_USER,
      subject: "SMTP Test — Deusizi Sparkle",
      text: "If you see this, email is working!",
    });
    return res.json({
      success: true,
      message: "Email sent to " + process.env.SMTP_USER,
    });
  } catch (err) {
    return res.json({ success: false, error: err.message });
  }
});

// ── User ──────────────────────────────────────────────────────────────
router.get("/", requireAuth, getNotifications);
router.get("/unread-count", requireAuth, getUnreadCount);
router.patch("/:id/read", requireAuth, markAsRead);
router.patch("/read-all", requireAuth, markAllAsRead);
router.patch("/read-type/:type", requireAuth, markTypeAsRead);
router.delete("/:id", requireAuth, deleteNotification);
router.delete("/clear/read", requireAuth, deleteAllRead);

// ── Preferences ───────────────────────────────────────────────────────
router.get("/preferences", requireAuth, getPreferences);
router.patch("/preferences", requireAuth, updatePreferences);

// ── Push tokens (future mobile) ───────────────────────────────────────
router.post("/push-token", requireAuth, registerPushToken);
router.delete("/push-token", requireAuth, deregisterPushToken);

// ── Admin ─────────────────────────────────────────────────────────────
router.get("/admin", requireAuth, requireRole("admin"), adminGetNotifications);
router.post(
  "/admin/announce",
  requireAuth,
  requireRole("admin"),
  adminSendAnnouncement,
);
router.post("/admin/send", requireAuth, requireRole("admin"), adminSendToUser);
router.delete(
  "/admin/cleanup",
  requireAuth,
  requireRole("admin"),
  adminCleanupNotifications,
);

export default router;
