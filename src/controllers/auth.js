// src/controllers/authController.js
const db = require("../config/database");
const redis = require("../config/redis"); // ← was missing, caused crash
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { OAuth2Client } = require("google-auth-library");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// ── Token helpers ─────────────────────────────────────────────────────────────
function generateTokens(userId) {
  const accessToken = jwt.sign({ id: userId }, JWT_SECRET, {
    expiresIn: "15m",
  });
  const refreshToken = jwt.sign({ id: userId }, JWT_SECRET, {
    expiresIn: "7d",
  });
  return { accessToken, refreshToken };
}

// ── Register ──────────────────────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { email, password, full_name, role } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({
        success: false,
        error: "Email, password, and full name are required",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid email format" });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 8 characters long",
      });
    }

    const existing = await db.query("SELECT id FROM users WHERE email = $1", [
      email.toLowerCase(),
    ]);
    if (existing.rows.length > 0) {
      return res
        .status(400)
        .json({ success: false, error: "User with this email already exists" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const user = await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, email, full_name, role, is_active, created_at`,
      [uuidv4(), email.toLowerCase(), password_hash, full_name, role || "user"],
    );

    const token = jwt.sign(
      {
        id: user.rows[0].id,
        email: user.rows[0].email,
        role: user.rows[0].role,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user: user.rows[0],
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to register user",
      details: error.message,
    });
  }
};

// ── Login ─────────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, error: "Email and password are required" });
    }

    const result = await db.query(
      "SELECT * FROM users WHERE email = $1 AND is_active = true",
      [email.toLowerCase()],
    );

    if (result.rows.length === 0) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid email or password" });
    }

    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid email or password" });
    }

    await db.query(
      "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1",
      [user.id],
    );

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );

    delete user.password_hash;
    res.json({ success: true, message: "Login successful", token, user });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to login",
      details: error.message,
    });
  }
};

// ── Google OAuth ──────────────────────────────────────────────────────────────
exports.googleVerify = async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res
        .status(400)
        .json({ success: false, error: "ID token required" });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { sub: googleId, email, name, picture } = ticket.getPayload();

    // Check for existing OAuth link
    const oauthRow = await db.query(
      "SELECT user_id FROM oauth_accounts WHERE provider = $1 AND provider_user_id = $2",
      ["google", googleId],
    );

    let userId;
    let isNewUser = false;

    if (oauthRow.rows.length > 0) {
      userId = oauthRow.rows[0].user_id;
    } else {
      isNewUser = true;
      userId = uuidv4();

      await db.query(
        `INSERT INTO users
     (id, email, full_name, profile_image, phone_number, password_hash,
      signup_method, is_verified, role, is_active, created_at, updated_at)
   VALUES ($1, $2, $3, $4, NULL, NULL, 'google', TRUE, 'user', TRUE, NOW(), NOW())`,
        [userId, email, name, picture],
      );

      await db.query(
        `INSERT INTO oauth_accounts
           (id, user_id, provider, provider_user_id, provider_email, profile_data, created_at, updated_at)
         VALUES ($1, $2, 'google', $3, $4, $5, NOW(), NOW())`,
        [
          uuidv4(),
          userId,
          googleId,
          email,
          JSON.stringify(ticket.getPayload()),
        ],
      );
    }

    const userRes = await db.query(
      "SELECT id, email, full_name, profile_image, role, phone_number FROM users WHERE id = $1",
      [userId],
    );
    const user = userRes.rows[0];

    // Long-lived token for AdminLogin (data.token)
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );

    // Short-lived pair for Register (data.tokens.accessToken)
    const { accessToken, refreshToken } = generateTokens(user.id);

    // Store refresh token in Redis (expires in 7 days)
    try {
      await redis.set(`refresh_token:${user.id}`, refreshToken, { EX: 604800 });
    } catch (redisErr) {
      console.warn(
        "Redis refresh token store failed (non-fatal):",
        redisErr.message,
      );
    }

    res.json({
      success: true,
      isNewUser,
      user,
      token, // AdminLogin.jsx → localStorage.setItem("token", data.token)
      tokens: { accessToken, refreshToken }, // Register.jsx  → saveAuth(data)
    });
  } catch (error) {
    console.error("Google verification error:", error);
    res.status(401).json({
      success: false,
      error: "Google token verification failed",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// ── Get current user ──────────────────────────────────────────────────────────
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await db.query(
      "SELECT id, email, full_name, role, is_active, created_at, last_login FROM users WHERE id = $1",
      [req.user.id],
    );
    if (!user.rows.length) {
      return res.status(404).json({ success: false, error: "User not found" });
    }
    res.json({ success: true, user: user.rows[0] });
  } catch (error) {
    console.error("Get current user error:", error);
    res.status(500).json({ success: false, error: "Failed to get user" });
  }
};

// ── Update profile ────────────────────────────────────────────────────────────
exports.updateProfile = async (req, res) => {
  try {
    const { full_name, phone, avatar } = req.body;
    const updates = {};
    if (full_name) updates.full_name = full_name;
    if (phone !== undefined) updates.phone = phone;
    if (avatar !== undefined) updates.avatar = avatar;

    if (!Object.keys(updates).length) {
      return res
        .status(400)
        .json({ success: false, error: "No fields to update" });
    }

    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(", ");
    values.push(req.user.id);

    const user = await db.query(
      `UPDATE users SET ${setClause}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${values.length}
       RETURNING id, email, full_name, role, is_active, created_at`,
      values,
    );
    res.json({
      success: true,
      message: "Profile updated successfully",
      user: user.rows[0],
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ success: false, error: "Failed to update profile" });
  }
};

// ── Change password ───────────────────────────────────────────────────────────
exports.changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res
        .status(400)
        .json({ success: false, error: "Both passwords are required" });
    }
    if (new_password.length < 8) {
      return res.status(400).json({
        success: false,
        error: "New password must be at least 8 characters",
      });
    }

    const result = await db.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [req.user.id],
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const isValid = await bcrypt.compare(
      current_password,
      result.rows[0].password_hash,
    );
    if (!isValid) {
      return res
        .status(401)
        .json({ success: false, error: "Current password is incorrect" });
    }

    const hash = await bcrypt.hash(new_password, 10);
    await db.query(
      "UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [hash, req.user.id],
    );
    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to change password" });
  }
};

// ── Forgot password ───────────────────────────────────────────────────────────
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res
        .status(400)
        .json({ success: false, error: "Email is required" });
    }

    const user = await db.query(
      "SELECT id, email FROM users WHERE email = $1",
      [email.toLowerCase()],
    );

    // Always return success (prevent email enumeration)
    if (!user.rows.length) {
      return res.json({
        success: true,
        message: "If that email exists, a reset link has been sent",
      });
    }

    const resetToken = jwt.sign({ id: user.rows[0].id }, JWT_SECRET, {
      expiresIn: "1h",
    });
    await db.query(
      `UPDATE users SET reset_token = $1, reset_token_expires = NOW() + INTERVAL '1 hour' WHERE id = $2`,
      [resetToken, user.rows[0].id],
    );

    console.log("Password reset token:", resetToken);

    res.json({
      success: true,
      message: "If that email exists, a reset link has been sent",
      ...(process.env.NODE_ENV === "development" && { resetToken }),
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to process request" });
  }
};

// ── Reset password ────────────────────────────────────────────────────────────
exports.resetPassword = async (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) {
      return res
        .status(400)
        .json({ success: false, error: "Token and new password are required" });
    }
    if (new_password.length < 8) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 8 characters",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return res
        .status(400)
        .json({ success: false, error: "Invalid or expired reset token" });
    }

    const user = await db.query(
      `SELECT id FROM users WHERE id = $1 AND reset_token = $2 AND reset_token_expires > NOW()`,
      [decoded.id, token],
    );
    if (!user.rows.length) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid or expired reset token" });
    }

    const hash = await bcrypt.hash(new_password, 10);
    await db.query(
      `UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL, updated_at = NOW() WHERE id = $2`,
      [hash, decoded.id],
    );
    res.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ success: false, error: "Failed to reset password" });
  }
};

// ── Admin: get all users ──────────────────────────────────────────────────────
exports.getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 50, role } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let where = "";

    if (role) {
      params.push(role);
      where = ` WHERE role = $${params.length}`;
    }

    params.push(parseInt(limit), parseInt(offset));
    const users = await db.query(
      `SELECT id, email, full_name, role, is_active, created_at, last_login FROM users${where}
       ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const countParams = role ? [role] : [];
    const total = await db.query(
      `SELECT COUNT(*) FROM users${role ? " WHERE role = $1" : ""}`,
      countParams,
    );

    res.json({
      success: true,
      users: users.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total.rows[0].count),
        pages: Math.ceil(total.rows[0].count / limit),
      },
    });
  } catch (error) {
    console.error("Get all users error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch users" });
  }
};

// ── Admin: update user role ───────────────────────────────────────────────────
exports.updateUserRole = async (req, res) => {
  try {
    const { role } = req.body;
    if (!["user", "admin", "editor"].includes(role)) {
      return res.status(400).json({ success: false, error: "Invalid role" });
    }
    const user = await db.query(
      `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, full_name, role, is_active`,
      [role, req.params.id],
    );
    if (!user.rows.length)
      return res.status(404).json({ success: false, error: "User not found" });
    res.json({ success: true, message: "Role updated", user: user.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to update role" });
  }
};

// ── Admin: toggle user status ─────────────────────────────────────────────────
exports.toggleUserStatus = async (req, res) => {
  try {
    const user = await db.query(
      `UPDATE users SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1 RETURNING id, email, full_name, role, is_active`,
      [req.params.id],
    );
    if (!user.rows.length)
      return res.status(404).json({ success: false, error: "User not found" });
    res.json({
      success: true,
      message: `User ${user.rows[0].is_active ? "activated" : "deactivated"}`,
      user: user.rows[0],
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, error: "Failed to toggle user status" });
  }
};

module.exports = exports;
