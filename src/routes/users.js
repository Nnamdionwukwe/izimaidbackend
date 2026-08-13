// src/routes/users.js

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// ── Save push token ──
router.post("/push-token", requireAuth, async (req, res) => {
  try {
    const { token, platform } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }

    // Validate token format
    if (!token || typeof token !== "string" || token.length < 10) {
      return res.status(400).json({ error: "Invalid token format" });
    }

    // Upsert the token
    await req.db.query(
      `INSERT INTO push_tokens (user_id, token, platform, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, true, now(), now())
       ON CONFLICT (user_id, token) DO UPDATE 
       SET platform = $3, is_active = true, updated_at = now()`,
      [req.user.id, token, platform || "unknown"],
    );

    console.log(`✅ Push token saved for user ${req.user.id}`);

    return res.status(200).json({
      success: true,
      message: "Push token saved successfully",
    });
  } catch (err) {
    console.error("Error saving push token:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get user's push tokens ──
router.get("/push-tokens", requireAuth, async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT token, platform, is_active, created_at, updated_at
       FROM push_tokens
       WHERE user_id = $1 AND is_active = true
       ORDER BY created_at DESC`,
      [req.user.id],
    );

    return res.status(200).json({
      success: true,
      tokens: rows,
    });
  } catch (err) {
    console.error("Error getting push tokens:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── Remove push token ──
router.delete("/push-token", requireAuth, async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }

    await req.db.query(
      `DELETE FROM push_tokens
       WHERE user_id = $1 AND token = $2`,
      [req.user.id, token],
    );

    console.log(`🗑️ Push token removed for user ${req.user.id}`);

    return res.status(200).json({
      success: true,
      message: "Push token removed successfully",
    });
  } catch (err) {
    console.error("Error removing push token:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
