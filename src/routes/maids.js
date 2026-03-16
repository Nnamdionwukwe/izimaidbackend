import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  listMaids,
  getMaid,
  updateProfile,
  getMaidReviews,
  adminUpdateMaid,
  adminDeactivateMaid,
  adminActivateMaid,
  adminDeleteReview,
} from "../controllers/maids.js";

const router = Router();

// ─── Public ──────────────────────────────────────────────────────────────────
router.get("/", listMaids);
router.get("/:id", getMaid);
router.get("/:id/reviews", getMaidReviews);

// ─── Maid (self) ─────────────────────────────────────────────────────────────
router.patch("/profile", requireAuth, requireRole("maid"), updateProfile);

// ─── Admin ───────────────────────────────────────────────────────────────────
router.patch("/:id", requireAuth, requireRole("admin"), adminUpdateMaid);
router.patch(
  "/:id/deactivate",
  requireAuth,
  requireRole("admin"),
  adminDeactivateMaid,
);
router.patch(
  "/:id/activate",
  requireAuth,
  requireRole("admin"),
  adminActivateMaid,
);
router.delete(
  "/:id/reviews/:reviewId",
  requireAuth,
  requireRole("admin"),
  adminDeleteReview,
);

export default router;
