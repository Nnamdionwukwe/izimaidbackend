// src/routes/wallet.routes.js
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  getWallet,
  getWalletHistory,
  // ── Admin — paste the 5 functions from wallet.admin.controller.js
  // into wallet.controller.js then import them here:
  adminListWallets,
  adminGetMaidWallet,
  adminCreditWallet,
  adminReleaseWallet,
  adminAdjustWallet,
} from "../controllers/wallet.controller.js";

const router = Router();
const admin = [requireAuth, requireRole("admin")];

// ── Maid routes ───────────────────────────────────────────────────────
router.get("/", requireAuth, requireRole("maid"), getWallet);
router.get("/history", requireAuth, requireRole("maid"), getWalletHistory);

// ── Admin routes ──────────────────────────────────────────────────────
router.get("/admin", ...admin, adminListWallets);
router.get("/admin/:maidId", ...admin, adminGetMaidWallet);
router.post("/admin/:maidId/credit", ...admin, adminCreditWallet);
router.post("/admin/:maidId/release", ...admin, adminReleaseWallet);
router.post("/admin/:maidId/adjust", ...admin, adminAdjustWallet);

export default router;
