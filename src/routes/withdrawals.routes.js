// src/routes/withdrawals.routes.js
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  getWallet,
  requestWithdrawal,
  getMyWithdrawals,
  cancelWithdrawal,
  getWalletHistory,
  adminListWithdrawals,
  adminProcessWithdrawal,
  adminAutoProcess,
  getNGBanks,
  verifyNGBankAccount,
  saveWithdrawalPreference,
} from "../controllers/withdrawals.controller.js";

const router = Router();

// ── Maid ──────────────────────────────────────────────────────────────
router.get("/wallet", requireAuth, requireRole("maid"), getWallet);
router.get(
  "/wallet/history",
  requireAuth,
  requireRole("maid"),
  getWalletHistory,
);
router.get("/", requireAuth, requireRole("maid"), getMyWithdrawals);
router.post("/", requireAuth, requireRole("maid"), requestWithdrawal);
router.patch("/:id/cancel", requireAuth, requireRole("maid"), cancelWithdrawal);

// ── Admin ─────────────────────────────────────────────────────────────
router.get("/admin", requireAuth, requireRole("admin"), adminListWithdrawals);
router.patch(
  "/admin/:id",
  requireAuth,
  requireRole("admin"),
  adminProcessWithdrawal,
);
router.post(
  "/admin/:id/auto-process",
  requireAuth,
  requireRole("admin"),
  adminAutoProcess,
);

// ── Nigerian bank helpers (public — needed on withdrawal form) ──────
router.get("/ng-banks", getNGBanks); // list all NG banks
router.post("/ng-banks/verify", requireAuth, verifyNGBankAccount); // verify account
router.post(
  "/preference",
  requireAuth,
  requireRole("maid"),
  saveWithdrawalPreference,
); // save preference

export default router;
