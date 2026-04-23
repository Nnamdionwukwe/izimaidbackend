// src/routes/wallet.routes.js
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  getWallet,
  getWalletHistory,
} from "../controllers/wallet.controller.js";

const router = Router();

router.get("/", requireAuth, requireRole("maid"), getWallet);
router.get("/history", requireAuth, requireRole("maid"), getWalletHistory);

export default router;
