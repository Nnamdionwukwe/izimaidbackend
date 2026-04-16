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
  // ── new ──
  getNearbyMaids,
  getMaidAvailability,
  setMaidAvailability,
  uploadMaidDocument,
  getMaidDocuments,
  adminReviewDocument,
} from "../controllers/maids.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB for documents
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"), false);
  },
});

// ─── Avatar ───────────────────────────────────────────────────
router.post("/avatar", requireAuth, upload.single("avatar"), uploadAvatar);

// ─── Admin ───────────────────────────────────────────────────
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
router.patch(
  "/admin/documents/:docId/review",
  requireAuth,
  requireRole("admin"),
  adminReviewDocument,
); // ← new

// ─── Maid self ────────────────────────────────────────────────
router.patch("/profile", requireAuth, updateProfile);
router.get("/my/documents", requireAuth, getMaidDocuments); // ← new
router.post(
  "/my/documents",
  requireAuth,
  upload.single("document"),
  uploadMaidDocument,
); // ← new
router.get("/my/availability", requireAuth, getMaidAvailability); // ← new (own)
router.put("/my/availability", requireAuth, setMaidAvailability); // ← new

// ─── Public ──────────────────────────────────────────────────
router.get("/nearby", getNearbyMaids); // ← new: ?lat=6.5&lng=3.3&radius_km=20
router.get("/", listMaids);
router.get("/:id", getMaid);
router.get("/:id/reviews", getMaidReviews);
router.get("/:id/availability", getMaidAvailability); // ← new: public view

export default router;
