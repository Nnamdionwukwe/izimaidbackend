// src/routes/auth.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  googleLogin,
  completeProfile,
  getMe,
  logout,
  register,
  verifyEmail,
  resendVerification,
  login,
  forgotPassword,
  resetPassword,
  updateProfile,
  changePassword,
  deleteAccount,
} from "../controllers/auth.js";
import { savePushToken } from "../controllers/bookings.js";

const router = Router();

import multer from "multer";
import { uploadAvatar } from "../controllers/auth.js";

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const valid = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (valid.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only images allowed"), false);
  },
});

router.post(
  "/avatar",
  requireAuth,
  avatarUpload.single("avatar"),
  uploadAvatar,
);

router.post("/google", googleLogin);
router.post("/complete-profile", requireAuth, completeProfile);
router.get("/me", requireAuth, getMe);
router.post("/logout", requireAuth, logout);
router.post("/register", register);
router.post("/login", login);
router.patch("/update-profile", requireAuth, updateProfile);
router.post("/push-token", requireAuth, savePushToken);
router.get("/verify-email/:token", verifyEmail);
router.post("/resend-verification", resendVerification);
router.post("/change-password", requireAuth, changePassword);
router.post("/forgot-password", forgotPassword);
router.post("/delete-account", requireAuth, deleteAccount);
router.post("/reset-password/:token", resetPassword);

export default router;
