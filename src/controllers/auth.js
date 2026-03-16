import jwt from "jsonwebtoken";
import { safeGet, safeSet, safeDel } from "../config/redis.js";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES },
  );
}

export const googleLogin = async (req, res) => {
  const { access_token, role = "customer" } = req.body;

  if (!access_token) {
    return res.status(400).json({ error: "access_token is required" });
  }
  if (!["customer", "maid"].includes(role)) {
    return res.status(400).json({ error: "role must be customer or maid" });
  }

  let googleUser;
  try {
    const response = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      },
    );
    if (!response.ok) {
      return res.status(401).json({ error: "invalid google access token" });
    }
    googleUser = await response.json();
  } catch (err) {
    console.error("[auth.controller/googleLogin] google verify failed", err);
    return res.status(401).json({ error: "failed to verify google token" });
  }

  const { sub: google_id, email, name, picture: avatar } = googleUser;

  if (!google_id || !email) {
    return res.status(401).json({ error: "incomplete google profile" });
  }

  try {
    // ── 1. Check if user already exists ────────────────────────────────────
    const { rows: existingRows } = await req.db.query(
      "SELECT * FROM users WHERE google_id = $1",
      [google_id],
    );

    let user;
    let isNewUser = false;

    if (existingRows.length > 0) {
      // ── User exists - DON'T change role, just update name/avatar ────────
      const existingUser = existingRows[0];

      const { rows: updatedRows } = await req.db.query(
        `UPDATE users 
         SET name = $1, avatar = $2, is_active = true, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *`,
        [name, avatar, existingUser.id],
      );
      user = updatedRows[0];

      console.log(
        `[auth.controller/googleLogin] Existing user login: ${user.email} (role: ${user.role})`,
      );
    } else {
      // ── New user - set role based on their selection ────────────────────
      const { rows: insertedRows } = await req.db.query(
        `INSERT INTO users (email, name, avatar, google_id, role, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING *`,
        [email, name, avatar, google_id, role],
      );
      user = insertedRows[0];
      isNewUser = true;

      console.log(
        `[auth.controller/googleLogin] New user signup: ${user.email} (role: ${user.role})`,
      );
    }

    // ── 2. Handle maid profile creation ────────────────────────────────────
    if (user.role === "maid") {
      // Check if maid profile exists
      const { rows: profileRows } = await req.db.query(
        "SELECT id FROM maid_profiles WHERE user_id = $1",
        [user.id],
      );

      if (profileRows.length === 0) {
        // Create maid profile if it doesn't exist
        await req.db.query(
          `INSERT INTO maid_profiles (user_id, hourly_rate, is_available)
           VALUES ($1, 0, false)`,
          [user.id],
        );

        console.log(
          `[auth.controller/googleLogin] Created maid profile for user ${user.id}`,
        );
      }
    }

    // ── 3. Cache the user ──────────────────────────────────────────────────
    await safeSet(`user:${user.id}`, 60 * 60 * 24 * 7, JSON.stringify(user));

    return res.status(200).json({ token: signToken(user), user });
  } catch (err) {
    console.error("[auth.controller/googleLogin]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const getMe = async (req, res) => {
  try {
    // Try cache first
    const cached = await safeGet(`user:${req.user.id}`);
    if (cached) return res.json({ user: JSON.parse(cached) });

    // Fetch from database if not cached
    const { rows } = await req.db.query(
      "SELECT * FROM users WHERE id = $1 AND is_active = true",
      [req.user.id],
    );

    if (!rows.length) return res.status(404).json({ error: "user not found" });

    const user = rows[0];

    // Cache for future requests
    await safeSet(`user:${user.id}`, 60 * 60 * 24 * 7, JSON.stringify(user));

    return res.json({ user });
  } catch (err) {
    console.error("[auth.controller/getMe]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const logout = async (req, res) => {
  try {
    // Delete user cache
    await safeDel(`user:${req.user.id}`);

    return res.json({ message: "logged out" });
  } catch (err) {
    console.error("[auth.controller/logout]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
