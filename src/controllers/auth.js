import jwt from "jsonwebtoken";
import { safeGet, safeSet, safeDel } from "../config/redis.js";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";

function signToken(user) {
  console.log("🔐 [TOKEN] Signing token...");
  console.log("🔐 [TOKEN] JWT_SECRET set:", !!JWT_SECRET);
  console.log("🔐 [TOKEN] JWT_SECRET length:", JWT_SECRET?.length);
  console.log("🔐 [TOKEN] JWT_EXPIRES:", JWT_EXPIRES);

  if (!JWT_SECRET) {
    console.error("❌ [TOKEN] JWT_SECRET is undefined! Check .env file");
    throw new Error("JWT_SECRET not configured");
  }

  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
  };

  console.log("🔐 [TOKEN] Payload:", payload);

  try {
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    console.log("✅ [TOKEN] Token signed successfully");
    console.log("🔐 [TOKEN] Token preview:", token.slice(0, 50) + "...");
    return token;
  } catch (err) {
    console.error("❌ [TOKEN] Failed to sign token:", err.message);
    throw err;
  }
}

// auth.controller.js - FIXED googleLogin function

export const googleLogin = async (req, res) => {
  console.log("\n📱 [GOOGLE LOGIN] Starting Google login...");

  const { access_token, role = "customer" } = req.body;

  console.log("📱 [GOOGLE LOGIN] Role received:", role);

  if (!access_token) {
    console.error("❌ [GOOGLE LOGIN] No access_token provided");
    return res.status(400).json({ error: "access_token is required" });
  }

  if (!["customer", "maid"].includes(role)) {
    console.error("❌ [GOOGLE LOGIN] Invalid role:", role);
    return res.status(400).json({ error: "role must be customer or maid" });
  }

  let googleUser;
  try {
    console.log("📱 [GOOGLE LOGIN] Verifying Google access token...");
    const response = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      },
    );

    if (!response.ok) {
      console.error("❌ [GOOGLE LOGIN] Google token verification failed");
      return res.status(401).json({ error: "invalid google access token" });
    }

    googleUser = await response.json();
    console.log("✅ [GOOGLE LOGIN] Google user verified:", googleUser.email);
  } catch (err) {
    console.error("[GOOGLE LOGIN] Google verify failed:", err);
    return res.status(401).json({ error: "failed to verify google token" });
  }

  const { sub: google_id, email, name, picture: avatar } = googleUser;

  if (!google_id || !email) {
    console.error("❌ [GOOGLE LOGIN] Incomplete Google profile");
    return res.status(401).json({ error: "incomplete google profile" });
  }

  try {
    // ── 1. Check if user already exists ────────────────────────────────────
    console.log("📋 [DB] Checking if user exists with google_id:", google_id);
    const { rows: existingRows } = await req.db.query(
      "SELECT * FROM users WHERE google_id = $1",
      [google_id],
    );

    let user;
    let isNewUser = false;

    if (existingRows.length > 0) {
      // ── User exists - preserve avatar, only update name ────────────────
      const existingUser = existingRows[0];
      console.log(
        "👤 [DB] User exists:",
        existingUser.id,
        "| Existing avatar:",
        existingUser.avatar ? "✅ Custom" : "❌ None",
      );

      const { rows: updatedRows } = await req.db.query(
        `UPDATE users 
         SET name = $1, is_active = true, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [name, existingUser.id],
        // ✅ NO avatar update - preserves custom uploaded avatar!
      );
      user = updatedRows[0];
      console.log(
        "✅ [DB] User updated (avatar preserved):",
        user.email,
        "| Role:",
        user.role,
      );
    } else {
      // ── New user - set role based on their selection + use Google avatar ────────────────
      console.log("🆕 [DB] New user. Creating with role:", role);
      const { rows: insertedRows } = await req.db.query(
        `INSERT INTO users (email, name, avatar, google_id, role, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING *`,
        [email, name, avatar, google_id, role], // ✅ Google avatar on first login
      );
      user = insertedRows[0];
      isNewUser = true;
      console.log(
        "✅ [DB] New user created:",
        user.email,
        "| Role:",
        user.role,
        "| Avatar: Google",
      );
    }

    // ── 2. Handle maid profile creation ────────────────────────────────────
    if (user.role === "maid") {
      console.log("🧑‍💼 [PROFILE] Checking maid profile for user:", user.id);
      const { rows: profileRows } = await req.db.query(
        "SELECT id FROM maid_profiles WHERE user_id = $1",
        [user.id],
      );

      if (profileRows.length === 0) {
        console.log("🆕 [PROFILE] Creating maid profile...");
        await req.db.query(
          `INSERT INTO maid_profiles (user_id, hourly_rate, is_available)
           VALUES ($1, 0, false)`,
          [user.id],
        );
        console.log("✅ [PROFILE] Maid profile created");
      } else {
        console.log("✅ [PROFILE] Maid profile already exists");
      }
    }

    // ── 3. Sign token ─────────────────────────────────────────────────────
    console.log(
      "🔐 [TOKEN] Signing JWT for user:",
      user.id,
      "| Role:",
      user.role,
    );
    const token = signToken(user);

    // ── 4. Cache the user ──────────────────────────────────────────────────
    console.log("💾 [CACHE] Caching user...");
    await safeSet(`user:${user.id}`, 60 * 60 * 24 * 7, JSON.stringify(user));
    console.log("✅ [CACHE] User cached");

    console.log("\n✅ [GOOGLE LOGIN] LOGIN SUCCESSFUL");
    console.log("📊 Final user:", {
      id: user.id,
      email: user.email,
      role: user.role,
      avatarPreserved: !isNewUser,
      isNewUser,
    });
    console.log("🔐 Token preview:", token.slice(0, 50) + "...\n");

    return res.status(200).json({ token, user });
  } catch (err) {
    console.error("[GOOGLE LOGIN] Error:", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// auth.controller.js — update getMe
export const getMe = async (req, res) => {
  console.log("👤 [GET ME] Fetching user:", req.user.id);

  try {
    const cached = await safeGet(`user:${req.user.id}`);
    if (cached) {
      console.log("✅ [GET ME] User found in cache");
      return res.json({ user: JSON.parse(cached) });
    }

    const { rows } = await req.db.query(
      "SELECT id, name, email, avatar, role, created_at FROM users WHERE id = $1 AND is_active = true",
      [req.user.id],
    );

    if (!rows.length) return res.status(404).json({ error: "user not found" });

    const user = rows[0];

    // ✅ 5 minute TTL instead of 7 days — avatar changes propagate quickly
    await safeSet(`user:${user.id}`, 60 * 5, JSON.stringify(user));

    return res.json({ user });
  } catch (err) {
    console.error("[GET ME]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const logout = async (req, res) => {
  console.log("🚪 [LOGOUT] User logging out:", req.user.id);

  try {
    // Delete user cache
    await safeDel(`user:${req.user.id}`);
    console.log("✅ [LOGOUT] Cache cleared");

    return res.json({ message: "logged out" });
  } catch (err) {
    console.error("[LOGOUT]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
