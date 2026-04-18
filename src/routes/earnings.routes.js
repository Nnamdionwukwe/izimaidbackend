// src/routes/earnings.routes.js
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  getEarnings,
  getEarningsStats,
} from "../controllers/earnings.controller.js";

const router = Router();

// GET /api/earnings?currency=NGN&period=this_month&status=completed&page=1&limit=20
router.get("/", requireAuth, requireRole("maid"), getEarnings);

// GET /api/earnings/stats
router.get("/stats", requireAuth, requireRole("maid"), getEarningsStats);

export default router;

// ── Register in app.js / server.js ────────────────────────────────────
// import earningsRouter from "./routes/earnings.routes.js";
// app.use("/api/earnings", earningsRouter);
