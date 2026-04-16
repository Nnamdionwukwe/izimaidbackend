// src/routes/admin.js
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  // Dashboard
  getStats,
  getRevenueReport,
  getFinancialOverview,
  // Users
  listUsers,
  getUser,
  updateUser,
  banUser,
  unbanUser,
  deleteUser,
  impersonateUser,
  // Bookings
  listBookings,
  getBooking,
  adminUpdateBookingStatus,
  // Maids
  listMaids,
  updateMaid,
  // Documents
  listPendingDocuments,
  reviewDocument,
  // SOS
  getSOSAlerts,
  resolveSOSAlert,
  // Settings
  getPlatformSettings,
  updatePlatformSetting,
  // Audit
  getAuditLog,
  // Support
  getSupportOverview,
} from "../controllers/admin.js";

const router = Router();
const admin = [requireAuth, requireRole("admin")];

// ── Dashboard ─────────────────────────────────────────────────────────
router.get("/stats", ...admin, getStats);
router.get("/revenue", ...admin, getRevenueReport);
router.get("/financial", ...admin, getFinancialOverview);
router.get("/support-overview", ...admin, getSupportOverview);

// ── Users ─────────────────────────────────────────────────────────────
router.get("/users", ...admin, listUsers);
router.get("/users/:id", ...admin, getUser);
router.patch("/users/:id", ...admin, updateUser);
router.post("/users/:id/ban", ...admin, banUser);
router.post("/users/:id/unban", ...admin, unbanUser);
router.delete("/users/:id", ...admin, deleteUser);
router.post("/users/:id/impersonate", ...admin, impersonateUser);

// ── Bookings ──────────────────────────────────────────────────────────
router.get("/bookings", ...admin, listBookings);
router.get("/bookings/:id", ...admin, getBooking);
router.patch("/bookings/:id/status", ...admin, adminUpdateBookingStatus);

// ── Maids ─────────────────────────────────────────────────────────────
router.get("/maids", ...admin, listMaids);
router.patch("/maids/:id", ...admin, updateMaid);

// ── Maid documents ────────────────────────────────────────────────────
router.get("/documents", ...admin, listPendingDocuments);
router.patch("/documents/:docId/review", ...admin, reviewDocument);

// ── SOS ───────────────────────────────────────────────────────────────
router.get("/sos", ...admin, getSOSAlerts);
router.patch("/sos/:alertId/resolve", ...admin, resolveSOSAlert);

// ── Platform settings ─────────────────────────────────────────────────
router.get("/settings", ...admin, getPlatformSettings);
router.patch("/settings/:key", ...admin, updatePlatformSetting);

// ── Audit log ─────────────────────────────────────────────────────────
router.get("/audit", ...admin, getAuditLog);

export default router;
