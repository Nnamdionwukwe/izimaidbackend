// Add this to src/routes/maids.js

import express from "express";
import multer from "multer";
import {
  listMaids,
  getMaid,
  updateProfile,
  getMaidReviews,
  uploadAvatar, // Import the new controller
} from "../controllers/maids.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// Configure multer for file upload
const storage = multer.memoryStorage(); // Store in memory, or use disk storage
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    // Only accept image files
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

// Public routes
router.get("/", listMaids);
router.get("/:id", getMaid);
router.get("/:id/reviews", getMaidReviews);

// Protected routes (require authentication)
router.patch("/profile", requireAuth, updateProfile);

// Avatar upload route (POST /api/maids/avatar)
router.post("/avatar", requireAuth, upload.single("avatar"), uploadAvatar);

export default router;
