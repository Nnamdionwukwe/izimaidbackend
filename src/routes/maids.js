// src/routes/maids.js - FIXED VERSION

import express from "express";
import multer from "multer";
import {
  listMaids,
  getMaid,
  updateProfile,
  getMaidReviews,
  uploadAvatar,
} from "../controllers/maids.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// Configure multer for avatar uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    console.log("[multer] File received:", file.originalname, file.mimetype);
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

// ⚠️ IMPORTANT: Avatar upload route MUST come FIRST before other routes
// Otherwise /:id will catch it and it won't work
router.post("/avatar", requireAuth, upload.single("avatar"), uploadAvatar);

// Public routes
router.get("/", listMaids);
router.get("/:id", getMaid);
router.get("/:id/reviews", getMaidReviews);

// Protected routes (require authentication)
router.patch("/profile", requireAuth, updateProfile);

export default router;
