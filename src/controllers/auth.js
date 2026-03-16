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
    // Insert or update user - including role update on conflict
    const { rows } = await req.db.query(
      `INSERT INTO users (email, name, avatar, google_id, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (google_id) DO UPDATE
         SET name = EXCLUDED.name, 
             avatar = EXCLUDED.avatar,
             role = EXCLUDED.role,
             is_active = true,
             updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [email, name, avatar, google_id, role],
    );

    const user = rows[0];

    // Only create maid profile if user role is maid and profile doesn't exist
    if (user.role === "maid") {
      await req.db.query(
        `INSERT INTO maid_profiles (user_id, hourly_rate, is_available)
         VALUES ($1, 0, false)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id],
      );
    }

    // Cache the user
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

    // Optional: Mark user as inactive in database
    // await req.db.query(
    //   "UPDATE users SET last_logout = CURRENT_TIMESTAMP WHERE id = $1",
    //   [req.user.id],
    // );

    return res.json({ message: "logged out" });
  } catch (err) {
    console.error("[auth.controller/logout]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
