import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  getSettings,
  updateSettings,
  getLanguages,
  getCurrencies,
  translateText,
} from "../controllers/settings.controller.js";

const router = Router();

// Public — no auth needed (needed on login screen before user is authed)
router.get("/languages", getLanguages);
router.get("/currencies", getCurrencies);
router.post("/translate", translateText);

// Authenticated
router.get("/", requireAuth, getSettings);
router.patch("/", requireAuth, updateSettings);

export default router;
