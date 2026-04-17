// import { Router } from "express";
// import { requireAuth } from "../middleware/auth.js";
// import {
//   googleLogin,
//   getMe,
//   logout,
//   register,
//   verifyEmail,
//   resendVerification,
//   login,
//   forgotPassword,
//   resetPassword,
// } from "../controllers/auth.js";

// const router = Router();

// router.post("/google", googleLogin);
// router.get("/me", requireAuth, getMe);
// router.post("/logout", requireAuth, logout);

// // ── New routes ──
// router.post("/register", register);
// router.post("/login", login);
// router.get("/verify-email/:token", verifyEmail);
// router.post("/resend-verification", resendVerification);
// router.post("/forgot-password", forgotPassword);
// router.post("/reset-password/:token", resetPassword);

// export default router;

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
} from "../controllers/auth.js";

const router = Router();

router.post("/google", googleLogin);
router.post("/complete-profile", requireAuth, completeProfile);
router.get("/me", requireAuth, getMe);
router.post("/logout", requireAuth, logout);
router.post("/register", register);
router.post("/login", login);
router.get("/verify-email/:token", verifyEmail);
router.post("/resend-verification", resendVerification);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);

export default router;
