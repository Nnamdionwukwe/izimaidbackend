// src/routes/settings.routes.js
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  getSettings,
  updateSettings,
  getLanguages,
  getCurrencies,
  translateText,
  // ── PIN ──
  getPinStatus,
  setTransactionPin,
  changeTransactionPin,
  verifyTransactionPin,
  requestPinReset,
  confirmPinReset,
} from "../controllers/settings.controller.js";

const router = Router();

// ── Public ────────────────────────────────────────────────────────────
router.get("/languages", getLanguages);
router.get("/currencies", getCurrencies);
router.post("/translate", translateText);

// ── PIN reset via token (no full auth needed — user is locked out) ────
router.post("/pin/reset/confirm", confirmPinReset);

// ── Authenticated ─────────────────────────────────────────────────────
router.get("/", requireAuth, getSettings);
router.patch("/", requireAuth, updateSettings);

// ── Transaction PIN (maid + customer both can have a PIN) ─────────────
router.get("/pin/status", requireAuth, getPinStatus);
router.post("/pin/set", requireAuth, setTransactionPin);
router.post("/pin/change", requireAuth, changeTransactionPin);
router.post("/pin/verify", requireAuth, verifyTransactionPin);
router.post("/pin/reset/request", requireAuth, requestPinReset);

export default router;
