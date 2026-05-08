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
  getNearbyMaids,
  getMaidAvailability,
  getMyAvailability,
  setMaidAvailability,
  uploadMaidDocument,
  getMaidDocuments,
  adminReviewDocument,
} from "../controllers/maids.js";
import debugReviewHook from "../db/logAdminReviewHit.js";

import { requireAuth, requireRole } from "../middleware/auth.js";
import { uploadMediaToCloudinary } from "../utils/cloudinary-utils.js";

const router = express.Router();

// ─────────────────────────────────────────────
// Multer setup
// ─────────────────────────────────────────────
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed =
      file.mimetype.startsWith("image/") || file.mimetype === "application/pdf";

    if (allowed) cb(null, true);
    else cb(new Error("Only image or PDF files are allowed"), false);
  },
});

// ─────────────────────────────────────────────
// Avatar upload (Auth required)
// ─────────────────────────────────────────────
router.post("/avatar", requireAuth, upload.single("avatar"), uploadAvatar);

// ─────────────────────────────────────────────
// ADMIN ROUTES (ORDER MATTERS!)
// Place document review FIRST to avoid route swallowing
// ─────────────────────────────────────────────

router.patch(
  "/admin/documents/:docId/review",
  requireAuth,
  requireRole("admin"),
  debugReviewHook, // <── ADD THIS
  adminReviewDocument,
);
// Review maid document (Approve/Reject)
router.patch(
  "/admin/documents/:docId/review",
  requireAuth,
  requireRole("admin"),
  adminReviewDocument,
);

// Admin manage maid status
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

// Admin update maid info
router.patch("/admin/:id", requireAuth, requireRole("admin"), adminUpdateMaid);

// Admin delete maid review
router.delete(
  "/admin/:id/reviews/:reviewId",
  requireAuth,
  requireRole("admin"),
  adminDeleteReview,
);

// Admin list maids
router.get("/admin/list", requireAuth, requireRole("admin"), adminListMaids);

// ─────────────────────────────────────────────
// MAID SELF ROUTES
// ─────────────────────────────────────────────
router.patch("/profile", requireAuth, updateProfile);

// Maid documents
router.get("/my/documents", requireAuth, getMaidDocuments);

router.post(
  "/my/documents",
  requireAuth,
  upload.single("document"),
  uploadMaidDocument,
);

// Maid availability
router.get("/my/availability", requireAuth, getMyAvailability);
router.put("/my/availability", requireAuth, setMaidAvailability);

// ─────────────────────────────────────────────
// PUBLIC ROUTES
// ─────────────────────────────────────────────
router.get("/nearby", getNearbyMaids);

router.get("/", listMaids);

router.get("/:id", getMaid);

router.get("/:id/reviews", getMaidReviews);

router.get("/:id/availability", getMaidAvailability);

// ─────────────────────────────────────────────
// Payment proof upload (Authorized)
// ─────────────────────────────────────────────
router.post(
  "/upload-proof",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    try {
      const result = await uploadMediaToCloudinary(
        req.file.buffer,
        "image",
        "deusizi/payment_proofs",
      );
      return res.json({ url: result.url });
    } catch (err) {
      console.error("[upload-proof]", err);
      return res.status(500).json({ error: "Upload failed" });
    }
  },
);

// ─────────────────────────────────────────────
export default router;
