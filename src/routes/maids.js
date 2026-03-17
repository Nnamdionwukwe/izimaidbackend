import express from "express";
import multer from "multer";
import {
  listMaids,
  getMaid,
  updateProfile,
  getMaidReviews,
  uploadAvatar,
  adminListMaids,
  adminUpdateMaid,
  adminDeactivateMaid,
  adminActivateMaid,
  adminDeleteReview,
} from "../controllers/maids.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// ─── Multer config ────────────────────────────────────────────
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

// ─── Avatar ───────────────────────────────────────────────────
// Must come before /:id to avoid being caught by the param route
router.post("/avatar", requireAuth, upload.single("avatar"), uploadAvatar);

// ─── Admin ───────────────────────────────────────────────────
// Must come before /:id for the same reason
router.get("/admin/list", requireAuth, requireRole("admin"), adminListMaids);
router.patch("/admin/:id", requireAuth, requireRole("admin"), adminUpdateMaid);
router.patch(
  "/admin/:id/activate",
  requireAuth,
  requireRole("admin"),
  adminActivateMaid,
);
router.patch(
  "/admin/:id/deactivate",
  requireAuth,
  requireRole("admin"),
  adminDeactivateMaid,
);
router.delete(
  "/admin/:id/reviews/:reviewId",
  requireAuth,
  requireRole("admin"),
  adminDeleteReview,
);

// ─── Public ──────────────────────────────────────────────────
router.get("/", listMaids);
router.get("/:id", getMaid);
router.get("/:id/reviews", getMaidReviews);

// ─── Maid (self) ─────────────────────────────────────────────
router.patch("/profile", requireAuth, updateProfile);

export default router;
