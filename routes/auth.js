import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { googleLogin, getMe, logout } from "../controllers/auth.js";

const router = Router();

router.post("/google", googleLogin);
router.get("/me", requireAuth, getMe);
router.post("/logout", requireAuth, logout);

export default router;
