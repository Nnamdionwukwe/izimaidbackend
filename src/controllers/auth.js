// src/controllers/auth.js
import jwt from "jsonwebtoken";
import { safeGet, safeSet, safeDel } from "../config/redis.js";
import crypto from "crypto";
import {
  sendVerificationEmail,
  sendNewLoginAlert,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from "../utils/mailer.js";

// ── Helpers ────────────────────────────────────────────────────────────

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, hash) => {
      if (err) reject(err);
      else resolve(`${salt}:${hash.toString("hex")}`);
    });
  });
}

async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else resolve(derived.toString("hex") === hash);
    });
  });
}

function getDeviceHash(req) {
  const ua = req.headers["user-agent"] || "";
  const lang = req.headers["accept-language"] || "";
  return crypto
    .createHash("sha256")
    .update(`${ua}${lang}`)
    .digest("hex")
    .slice(0, 16);
}

function getDeviceLabel(req) {
  const ua = req.headers["user-agent"] || "Unknown";
  if (ua.includes("Chrome")) return "Chrome Browser";
  if (ua.includes("Firefox")) return "Firefox Browser";
  if (ua.includes("Safari")) return "Safari Browser";
  if (ua.includes("Mobile")) return "Mobile Browser";
  return "Unknown Browser";
}

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";

function signToken(user) {
  if (!JWT_SECRET) throw new Error("JWT_SECRET not configured");
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES,
    },
  );
}

// Record device + send new-device alert if first time from this device
async function handleDeviceTracking(db, user, req) {
  const deviceHash = getDeviceHash(req);
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket?.remoteAddress ||
    "unknown";
  const userAgent = req.headers["user-agent"] || "unknown";

  const { rows: deviceRows } = await db.query(
    `SELECT id FROM user_devices WHERE user_id = $1 AND device_hash = $2`,
    [user.id, deviceHash],
  );

  if (deviceRows.length === 0) {
    await db.query(
      `INSERT INTO user_devices (user_id, device_hash, user_agent, ip_address)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, device_hash) DO UPDATE SET last_seen_at = now(), ip_address = $4`,
      [user.id, deviceHash, userAgent, ip],
    );
    // Fire and forget — don't block login
    sendNewLoginAlert(user, {
      ip,
      userAgent,
      device: getDeviceLabel(req),
    }).catch(console.error);
  } else {
    await db.query(
      `UPDATE user_devices SET last_seen_at = now(), ip_address = $1
       WHERE user_id = $2 AND device_hash = $3`,
      [ip, user.id, deviceHash],
    );
  }
}

// ── Google Login / Register ────────────────────────────────────────────
export const googleLogin = async (req, res) => {
  const { access_token, role = "customer" } = req.body;

  if (!access_token)
    return res.status(400).json({ error: "access_token is required" });
  if (!["customer", "maid"].includes(role))
    return res.status(400).json({ error: "role must be customer or maid" });

  // 1. Verify Google token
  let googleUser;
  try {
    const response = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      },
    );
    if (!response.ok)
      return res.status(401).json({ error: "invalid google access token" });
    googleUser = await response.json();
  } catch {
    return res.status(401).json({ error: "failed to verify google token" });
  }

  const { sub: google_id, email, name, picture: google_avatar } = googleUser;
  if (!google_id || !email)
    return res.status(401).json({ error: "incomplete google profile" });

  try {
    // 2. Find user by google_id OR email (handles accounts created via email first)
    const { rows: existing } = await req.db.query(
      `SELECT * FROM users WHERE google_id = $1 OR email = $2 LIMIT 1`,
      [google_id, email],
    );

    let user;
    let isNewUser = false;

    if (existing.length > 0) {
      // ── Existing user — link google_id if missing, preserve custom avatar
      const found = existing[0];

      const { rows: updated } = await req.db.query(
        `UPDATE users
         SET name       = $1,
             google_id  = COALESCE(google_id, $2),
             is_active  = true,
             updated_at = now()
         WHERE id = $3
         RETURNING *`,
        [name, google_id, found.id],
      );
      user = updated[0];
    } else {
      // ── New user — create with Google avatar
      isNewUser = true;

      const { rows: inserted } = await req.db.query(
        `INSERT INTO users (email, name, avatar, google_id, role, is_active, email_verified)
         VALUES ($1, $2, $3, $4, $5, true, true)
         RETURNING *`,
        [email, name, google_avatar, google_id, role],
      );
      user = inserted[0];

      // Create maid profile if needed
      if (role === "maid") {
        await req.db.query(
          `INSERT INTO maid_profiles (user_id, hourly_rate, is_available)
     SELECT $1, 0, false
     WHERE NOT EXISTS (SELECT 1 FROM maid_profiles WHERE user_id = $1)`,
          [user.id],
        );
      }

      // Create default settings
      await req.db.query(
        `INSERT INTO user_settings (user_id, language, currency)
   SELECT $1, 'en', 'NGN'
   WHERE NOT EXISTS (SELECT 1 FROM user_settings WHERE user_id = $1)`,
        [user.id],
      );
    }

    // 3. Device tracking + new device alert
    await handleDeviceTracking(req.db, user, req);

    // 4. Sign token
    const token = signToken(user);

    // 5. Cache user (5 min TTL — avatar changes propagate quickly)
    const { password_hash, ...safeUser } = user;
    await safeSet(`user:${user.id}`, 60 * 5, JSON.stringify(safeUser));

    return res.status(200).json({
      token,
      user: safeUser,
      isNewUser,
      // Tell frontend to show phone prompt if new user has no phone
      needsPhone: !!user.google_id && !user.phone,
    });
  } catch (err) {
    console.error("[googleLogin]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Complete profile (phone number after Google register) ─────────────
export const completeProfile = async (req, res) => {
  const { phone } = req.body;

  if (!phone) return res.status(400).json({ error: "phone is required" });
  if (!/^\+?[\d\s\-()]{7,15}$/.test(phone)) {
    return res
      .status(400)
      .json({ error: "enter a valid phone number with country code" });
  }

  try {
    const { rows } = await req.db.query(
      `UPDATE users SET phone = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [phone, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: "user not found" });

    const user = rows[0];

    // Send welcome email now that profile is complete
    sendWelcomeEmail(user).catch(console.error);

    // Bust cache so next /me returns fresh data
    await safeDel(`user:${user.id}`);

    const { password_hash, ...safeUser } = user;
    return res.json({ message: "Profile updated", user: safeUser });
  } catch (err) {
    console.error("[completeProfile]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Get current user ───────────────────────────────────────────────────
export const getMe = async (req, res) => {
  try {
    const cached = await safeGet(`user:${req.user.id}`);
    if (cached) return res.json({ user: JSON.parse(cached) });

    const { rows } = await req.db.query(
      `SELECT u.id, u.name, u.email, u.avatar, u.role, u.phone, u.country,
              u.language, u.email_verified, u.auth_provider, u.created_at,
              s.theme, s.currency, s.notifications_email, s.notifications_push
       FROM users u
       LEFT JOIN user_settings s ON s.user_id = u.id
       WHERE u.id = $1 AND u.is_active = true`,
      [req.user.id],
    );

    if (!rows.length) return res.status(404).json({ error: "user not found" });

    await safeSet(`user:${rows[0].id}`, 60 * 5, JSON.stringify(rows[0]));
    return res.json({ user: rows[0] });
  } catch (err) {
    console.error("[getMe]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Logout ────────────────────────────────────────────────────────────
export const logout = async (req, res) => {
  try {
    await safeDel(`user:${req.user.id}`);
    return res.json({ message: "logged out" });
  } catch (err) {
    console.error("[logout]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Register with email/password ──────────────────────────────────────
export const register = async (req, res) => {
  const {
    name,
    email,
    password,
    role = "customer",
    phone,
    country = "NG",
    language = "en",
  } = req.body;

  if (!name || !email || !password)
    return res
      .status(400)
      .json({ error: "name, email and password are required" });
  if (!["customer", "maid"].includes(role))
    return res.status(400).json({ error: "role must be customer or maid" });
  if (password.length < 8)
    return res
      .status(400)
      .json({ error: "password must be at least 8 characters" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: "invalid email address" });

  try {
    // Check if email already exists
    const { rows: existing } = await req.db.query(
      `SELECT id, auth_provider, google_id FROM users WHERE email = $1`,
      [email.toLowerCase()],
    );

    if (existing.length) {
      const found = existing[0];
      if (found.google_id) {
        // Email exists via Google — add password to the account so they can use both
        const password_hash = await hashPassword(password);
        await req.db.query(
          `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`,
          [password_hash, found.id],
        );
        return res.status(409).json({
          error:
            "this email is already registered via Google sign-in. We've linked your password — please log in.",
          code: "GOOGLE_ACCOUNT_LINKED",
        });
      }
      return res.status(409).json({ error: "email already registered" });
    }

    const password_hash = await hashPassword(password);
    const verify_token = crypto.randomBytes(32).toString("hex");
    const verify_expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const { rows } = await req.db.query(
      `INSERT INTO users
         (email, name, role, phone, country, language, password_hash,
          auth_provider, email_verified, email_verify_token, email_verify_expires, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'email',false,$8,$9,true)
       RETURNING id, email, name, role, avatar, phone, country, language, email_verified, created_at`,
      [
        email.toLowerCase(),
        name,
        role,
        phone || null,
        country,
        language,
        password_hash,
        verify_token,
        verify_expires,
      ],
    );

    const user = rows[0];

    if (role === "maid") {
      await req.db.query(
        `INSERT INTO maid_profiles (user_id, hourly_rate, is_available)
 SELECT $1, 0, false WHERE NOT EXISTS (SELECT 1 FROM maid_profiles WHERE user_id = $1)`,
        [user.id],
      );
    }

    await req.db.query(
      `INSERT INTO user_settings (user_id, language, currency)
 SELECT $1, $2, 'NGN' WHERE NOT EXISTS (SELECT 1 FROM user_settings WHERE user_id = $1)`,
      [user.id, language],
    );

    sendVerificationEmail(user, verify_token).catch(console.error);

    return res.status(201).json({
      message:
        "Account created. Please check your email to verify your account.",
      user: { ...user, email_verified: false },
    });
  } catch (err) {
    console.error("[register]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Verify email ──────────────────────────────────────────────────────
export const verifyEmail = async (req, res) => {
  const { token } = req.params;
  if (!token) return res.status(400).json({ error: "token is required" });

  try {
    const { rows } = await req.db.query(
      `UPDATE users
       SET email_verified        = true,
           email_verify_token    = null,
           email_verify_expires  = null,
           updated_at            = now()
       WHERE email_verify_token  = $1
         AND email_verify_expires > now()
         AND email_verified       = false
       RETURNING id, email, name, role`,
      [token],
    );

    if (!rows.length) {
      return res
        .status(400)
        .json({ error: "invalid or expired verification link" });
    }

    const verifiedUser = rows[0];

    // Send welcome email — fire and forget
    sendWelcomeEmail(verifiedUser).catch(console.error);

    return res.json({
      message: "Email verified successfully. You can now log in.",
      user: verifiedUser,
    });
  } catch (err) {
    console.error("[verifyEmail]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Resend verification email ─────────────────────────────────────────
export const resendVerification = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email is required" });

  try {
    const new_token = crypto.randomBytes(32).toString("hex");
    const new_expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const { rows } = await req.db.query(
      `UPDATE users
       SET email_verify_token = $1, email_verify_expires = $2, updated_at = now()
       WHERE email = $3 AND email_verified = false
       RETURNING id, email, name`,
      [new_token, new_expires, email.toLowerCase()],
    );

    if (rows.length)
      sendVerificationEmail(rows[0], new_token).catch(console.error);

    return res.json({
      message:
        "If that email exists and is unverified, a new link has been sent.",
    });
  } catch (err) {
    console.error("[resendVerification]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Login with email/password ─────────────────────────────────────────
export const login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "email and password are required" });

  try {
    const { rows } = await req.db.query(
      `SELECT id, email, name, avatar, role, password_hash, google_id,
              email_verified, is_active, country, language, phone
       FROM users WHERE email = $1`,
      [email.toLowerCase()],
    );

    if (!rows.length)
      return res.status(401).json({ error: "invalid email or password" });

    const user = rows[0];

    if (!user.is_active)
      return res.status(403).json({ error: "account has been deactivated" });

    // No password set — Google-only account that hasn't been linked yet
    if (!user.password_hash) {
      return res.status(400).json({
        error:
          'this account was created with Google sign-in and has no password. Please sign in with Google or use "Forgot password" to set a password.',
        code: "NO_PASSWORD_SET",
        has_google: !!user.google_id,
      });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ error: "invalid email or password" });

    if (!user.email_verified) {
      return res.status(403).json({
        error: "email not verified",
        code: "EMAIL_NOT_VERIFIED",
        message:
          "Please check your email and click the verification link before logging in.",
        email: user.email,
      });
    }

    // Device tracking
    await handleDeviceTracking(req.db, user, req);

    const token = signToken(user);
    const { password_hash, ...safeUser } = user;
    await safeSet(`user:${user.id}`, 60 * 5, JSON.stringify(safeUser));

    return res.json({ token, user: safeUser });
  } catch (err) {
    console.error("[login]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Forgot password ───────────────────────────────────────────────────
export const forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email is required" });

  try {
    const reset_token = crypto.randomBytes(32).toString("hex");
    const reset_expires = new Date(Date.now() + 60 * 60 * 1000);

    // Allow ANY user (including Google-created) to reset/set a password
    const { rows } = await req.db.query(
      `UPDATE users
       SET reset_token = $1, reset_token_expires = $2, updated_at = now()
       WHERE email = $3 AND is_active = true
       RETURNING id, email, name`,
      [reset_token, reset_expires, email.toLowerCase()],
    );

    if (rows.length)
      sendPasswordResetEmail(rows[0], reset_token).catch(console.error);

    return res.json({
      message: "If that email exists, a reset link has been sent.",
    });
  } catch (err) {
    console.error("[forgotPassword]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Reset password ────────────────────────────────────────────────────
export const resetPassword = async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  if (!token || !password)
    return res.status(400).json({ error: "token and password are required" });
  if (password.length < 8)
    return res
      .status(400)
      .json({ error: "password must be at least 8 characters" });

  try {
    const { rows: tokenRows } = await req.db.query(
      `SELECT id, email FROM users
       WHERE reset_token = $1 AND reset_token_expires > now() AND is_active = true`,
      [token],
    );

    if (!tokenRows.length)
      return res.status(400).json({ error: "invalid or expired reset link" });

    const password_hash = await hashPassword(password);

    await req.db.query(
      `UPDATE users
       SET password_hash         = $1,
           reset_token           = null,
           reset_token_expires   = null,
           updated_at            = now()
       WHERE id = $2`,
      [password_hash, tokenRows[0].id],
    );

    await safeDel(`user:${tokenRows[0].id}`);

    return res.json({
      message: "Password reset successfully. You can now log in.",
    });
  } catch (err) {
    console.error("[resetPassword]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
