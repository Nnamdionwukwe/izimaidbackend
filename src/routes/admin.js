import { Router } from "express";
import {
  listUsers,
  updateUser,
  deleteUser,
  listBookings,
  getStats,
} from "../controllers/admin.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// ── Users Routes ──────────────────────────────────────────────────────────────
/**
 * GET /api/admin/users
 * List all users with optional filtering by role
 * Query: page, limit, role
 * Auth: Admin only
 */
router.get("/users", requireAuth, requireRole("admin"), listUsers);

/**
 * PATCH /api/admin/users/:id
 * Update user (role, is_active status)
 * Body: { role?, is_active? }
 * Auth: Admin only
 */
router.patch("/users/:id", requireAuth, requireRole("admin"), updateUser);

/**
 * DELETE /api/admin/users/:id
 * Delete user and handle related data
 * Cascades: maid profiles, bookings, reviews, payments
 * Auth: Admin only
 */
router.delete("/users/:id", requireAuth, requireRole("admin"), deleteUser);

// ── Bookings Routes ───────────────────────────────────────────────────────────
/**
 * GET /api/admin/bookings
 * List all bookings with optional filtering by status
 * Query: page, limit, status
 * Auth: Admin only
 */
router.get("/bookings", requireAuth, requireRole("admin"), listBookings);

// ── Stats Routes ──────────────────────────────────────────────────────────────
/**
 * GET /api/admin/stats
 * Get dashboard statistics
 * Returns: users by role, bookings by status, total revenue
 * Auth: Admin only
 */
router.get("/stats", requireAuth, requireRole("admin"), getStats);

export default router;
