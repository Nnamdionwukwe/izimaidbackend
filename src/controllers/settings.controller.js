// src/controllers/settings.controller.js
import crypto from "crypto";

// ── PIN helpers ───────────────────────────────────────────────────────
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 30;

function hashPin(pin) {
  // Use scrypt — same as password hashing, no bcrypt dependency
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(pin, salt, 32, (err, hash) => {
      if (err) reject(err);
      else resolve(`${salt}:${hash.toString("hex")}`);
    });
  });
}

function verifyPin(pin, stored) {
  const [salt, hash] = stored.split(":");
  return new Promise((resolve, reject) => {
    crypto.scrypt(pin, salt, 32, (err, derived) => {
      if (err) reject(err);
      else resolve(derived.toString("hex") === hash);
    });
  });
}

// ── Set transaction PIN ───────────────────────────────────────────────
export async function setTransactionPin(req, res) {
  const { pin, confirm_pin, password } = req.body;

  if (!pin || !confirm_pin) {
    return res.status(400).json({ error: "pin and confirm_pin are required" });
  }
  if (!/^\d{4,6}$/.test(pin)) {
    return res.status(400).json({ error: "PIN must be 4–6 digits" });
  }
  if (pin !== confirm_pin) {
    return res.status(400).json({ error: "PINs do not match" });
  }
  // Reject common PINs
  const COMMON_PINS = [
    "1234",
    "0000",
    "1111",
    "2222",
    "3333",
    "4444",
    "5555",
    "6666",
    "7777",
    "8888",
    "9999",
    "123456",
    "000000",
  ];
  if (COMMON_PINS.includes(pin)) {
    return res
      .status(400)
      .json({ error: "PIN is too common. Choose a less obvious combination." });
  }

  try {
    // Require password confirmation when setting/changing PIN
    if (password) {
      const { rows: userRows } = await req.db.query(
        `SELECT password_hash, auth_provider FROM users WHERE id = $1`,
        [req.user.id],
      );
      if (
        userRows[0]?.auth_provider === "email" &&
        userRows[0]?.password_hash
      ) {
        const [salt, hash] = userRows[0].password_hash.split(":");
        const valid = await new Promise((res, rej) => {
          crypto.scrypt(password, salt, 64, (err, d) => {
            if (err) rej(err);
            else res(d.toString("hex") === hash);
          });
        });
        if (!valid) {
          return res.status(401).json({ error: "incorrect password" });
        }
      }
    }

    const pin_hash = await hashPin(pin);

    await req.db.query(
      `UPDATE users
       SET transaction_pin_hash = $1, pin_set_at = now(),
           pin_failed_attempts = 0, pin_locked_until = null,
           updated_at = now()
       WHERE id = $2`,
      [pin_hash, req.user.id],
    );

    return res.json({ message: "Transaction PIN set successfully" });
  } catch (err) {
    console.error("[settings/setTransactionPin]", err);
    return res.status(500).json({ error: "internal server error" });
  }
}

// ── Change transaction PIN ────────────────────────────────────────────
export async function changeTransactionPin(req, res) {
  const { current_pin, new_pin, confirm_new_pin } = req.body;

  if (!current_pin || !new_pin || !confirm_new_pin) {
    return res
      .status(400)
      .json({ error: "current_pin, new_pin and confirm_new_pin are required" });
  }
  if (!/^\d{4,6}$/.test(new_pin)) {
    return res.status(400).json({ error: "PIN must be 4–6 digits" });
  }
  if (new_pin !== confirm_new_pin) {
    return res.status(400).json({ error: "new PINs do not match" });
  }
  if (current_pin === new_pin) {
    return res
      .status(400)
      .json({ error: "new PIN must be different from current PIN" });
  }

  const COMMON_PINS = [
    "1234",
    "0000",
    "1111",
    "2222",
    "3333",
    "4444",
    "5555",
    "6666",
    "7777",
    "8888",
    "9999",
    "123456",
    "000000",
  ];
  if (COMMON_PINS.includes(new_pin)) {
    return res
      .status(400)
      .json({ error: "PIN is too common. Choose a less obvious combination." });
  }

  try {
    const { rows } = await req.db.query(
      `SELECT transaction_pin_hash, pin_failed_attempts, pin_locked_until
       FROM users WHERE id = $1`,
      [req.user.id],
    );

    if (!rows.length || !rows[0].transaction_pin_hash) {
      return res.status(400).json({ error: "no PIN set — use set-pin first" });
    }

    const user = rows[0];

    // Check if locked
    if (user.pin_locked_until && new Date(user.pin_locked_until) > new Date()) {
      const minutesLeft = Math.ceil(
        (new Date(user.pin_locked_until) - Date.now()) / 60000,
      );
      return res.status(429).json({
        error: `PIN is locked. Try again in ${minutesLeft} minute(s).`,
      });
    }

    const valid = await verifyPin(current_pin, user.transaction_pin_hash);
    if (!valid) {
      const newAttempts = (user.pin_failed_attempts || 0) + 1;
      const shouldLock = newAttempts >= PIN_MAX_ATTEMPTS;
      await req.db.query(
        `UPDATE users
         SET pin_failed_attempts = $1,
             pin_locked_until = $2
         WHERE id = $3`,
        [
          shouldLock ? 0 : newAttempts,
          shouldLock ? new Date(Date.now() + PIN_LOCK_MINUTES * 60000) : null,
          req.user.id,
        ],
      );
      const attemptsLeft = PIN_MAX_ATTEMPTS - newAttempts;
      return res.status(401).json({
        error: shouldLock
          ? `Too many failed attempts. PIN locked for ${PIN_LOCK_MINUTES} minutes.`
          : `Incorrect PIN. ${attemptsLeft} attempt(s) remaining.`,
        locked: shouldLock,
      });
    }

    const new_hash = await hashPin(new_pin);
    await req.db.query(
      `UPDATE users
       SET transaction_pin_hash = $1, pin_set_at = now(),
           pin_failed_attempts = 0, pin_locked_until = null,
           updated_at = now()
       WHERE id = $2`,
      [new_hash, req.user.id],
    );

    return res.json({ message: "Transaction PIN changed successfully" });
  } catch (err) {
    console.error("[settings/changeTransactionPin]", err);
    return res.status(500).json({ error: "internal server error" });
  }
}

// ── Verify PIN (used by withdrawals before submitting) ────────────────
// Returns { valid: true } or error — does NOT process anything
export async function verifyTransactionPin(req, res) {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: "pin is required" });

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket?.remoteAddress ||
    "unknown";

  try {
    const { rows } = await req.db.query(
      `SELECT transaction_pin_hash, pin_failed_attempts, pin_locked_until
       FROM users WHERE id = $1`,
      [req.user.id],
    );

    if (!rows.length || !rows[0].transaction_pin_hash) {
      return res.status(400).json({
        error: "no transaction PIN set",
        code: "PIN_NOT_SET",
      });
    }

    const user = rows[0];

    // Check lock
    if (user.pin_locked_until && new Date(user.pin_locked_until) > new Date()) {
      const minutesLeft = Math.ceil(
        (new Date(user.pin_locked_until) - Date.now()) / 60000,
      );
      await req.db.query(
        `INSERT INTO pin_attempts (user_id, success, ip_address) VALUES ($1, false, $2)`,
        [req.user.id, ip],
      );
      return res.status(429).json({
        error: `PIN locked. Try again in ${minutesLeft} minute(s).`,
        locked: true,
      });
    }

    const valid = await verifyPin(pin, user.transaction_pin_hash);

    // Log attempt
    await req.db.query(
      `INSERT INTO pin_attempts (user_id, success, ip_address) VALUES ($1, $2, $3)`,
      [req.user.id, valid, ip],
    );

    if (!valid) {
      const newAttempts = (user.pin_failed_attempts || 0) + 1;
      const shouldLock = newAttempts >= PIN_MAX_ATTEMPTS;
      await req.db.query(
        `UPDATE users
         SET pin_failed_attempts = $1, pin_locked_until = $2
         WHERE id = $3`,
        [
          shouldLock ? 0 : newAttempts,
          shouldLock ? new Date(Date.now() + PIN_LOCK_MINUTES * 60000) : null,
          req.user.id,
        ],
      );
      const attemptsLeft = PIN_MAX_ATTEMPTS - newAttempts;
      return res.status(401).json({
        error: shouldLock
          ? `Too many failed attempts. PIN locked for ${PIN_LOCK_MINUTES} minutes.`
          : `Incorrect PIN. ${attemptsLeft} attempt(s) remaining.`,
        locked: shouldLock,
        attempts_left: attemptsLeft,
      });
    }

    // Reset failed attempts on success
    await req.db.query(
      `UPDATE users SET pin_failed_attempts = 0, pin_locked_until = null WHERE id = $1`,
      [req.user.id],
    );

    return res.json({ valid: true });
  } catch (err) {
    console.error("[settings/verifyTransactionPin]", err);
    return res.status(500).json({ error: "internal server error" });
  }
}

// ── Get PIN status (has pin been set?) ────────────────────────────────
export async function getPinStatus(req, res) {
  try {
    const { rows } = await req.db.query(
      `SELECT
         transaction_pin_hash IS NOT NULL as pin_set,
         pin_set_at,
         pin_failed_attempts,
         pin_locked_until
       FROM users WHERE id = $1`,
      [req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: "user not found" });

    const { pin_set, pin_set_at, pin_failed_attempts, pin_locked_until } =
      rows[0];
    const is_locked =
      pin_locked_until && new Date(pin_locked_until) > new Date();

    return res.json({
      pin_set,
      pin_set_at,
      is_locked,
      locked_until: is_locked ? pin_locked_until : null,
      failed_attempts: is_locked ? pin_failed_attempts : 0,
    });
  } catch (err) {
    console.error("[settings/getPinStatus]", err);
    return res.status(500).json({ error: "internal server error" });
  }
}

// ── Reset PIN via email (sends reset link) ────────────────────────────
export async function requestPinReset(req, res) {
  try {
    const reset_token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await req.db.query(
      `UPDATE users
       SET reset_token = $1, reset_token_expires = $2
       WHERE id = $3`,
      [reset_token, expires, req.user.id],
    );

    const { rows } = await req.db.query(
      `SELECT name, email FROM users WHERE id = $1`,
      [req.user.id],
    );

    const FRONTEND = process.env.CLIENT_URL || process.env.FRONTEND_URL;
    const link = `${FRONTEND}/settings/reset-pin?token=${reset_token}`;

    // Fire and forget
    import("../utils/mailer.js")
      .then(({ sendEmail }) => {
        sendEmail({
          to: rows[0].email,
          subject: `Reset your transaction PIN — ${process.env.APP_NAME}`,
          html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="color:#1e3a8a">Reset your transaction PIN</h2>
            <p>Hi ${rows[0].name}, click the link below to reset your transaction PIN.</p>
            <a href="${link}" style="display:inline-block;padding:12px 28px;
               background:#1e3a8a;color:#fff;border-radius:8px;text-decoration:none;
               font-weight:600;margin:20px 0">Reset Transaction PIN</a>
            <p style="color:#94a3b8;font-size:13px">This link expires in 1 hour.</p>
          </div>
        `,
        });
      })
      .catch(console.error);

    return res.json({ message: "PIN reset link sent to your email." });
  } catch (err) {
    console.error("[settings/requestPinReset]", err);
    return res.status(500).json({ error: "internal server error" });
  }
}

// ── Confirm PIN reset via token ───────────────────────────────────────
export async function confirmPinReset(req, res) {
  const { token, new_pin, confirm_new_pin } = req.body;

  if (!token || !new_pin || !confirm_new_pin) {
    return res
      .status(400)
      .json({ error: "token, new_pin and confirm_new_pin are required" });
  }
  if (!/^\d{4,6}$/.test(new_pin)) {
    return res.status(400).json({ error: "PIN must be 4–6 digits" });
  }
  if (new_pin !== confirm_new_pin) {
    return res.status(400).json({ error: "PINs do not match" });
  }

  try {
    const { rows } = await req.db.query(
      `SELECT id FROM users
       WHERE reset_token = $1 AND reset_token_expires > now() AND is_active = true`,
      [token],
    );
    if (!rows.length) {
      return res.status(400).json({ error: "invalid or expired reset link" });
    }

    const pin_hash = await hashPin(new_pin);
    await req.db.query(
      `UPDATE users
       SET transaction_pin_hash = $1, pin_set_at = now(),
           pin_failed_attempts = 0, pin_locked_until = null,
           reset_token = null, reset_token_expires = null,
           updated_at = now()
       WHERE id = $2`,
      [pin_hash, rows[0].id],
    );

    return res.json({
      message:
        "Transaction PIN reset successfully. You can now log in with your new PIN.",
    });
  } catch (err) {
    console.error("[settings/confirmPinReset]", err);
    return res.status(500).json({ error: "internal server error" });
  }
}

// ── Existing functions — keep all of these unchanged ──────────────────

export async function getSettings(req, res) {
  try {
    const { rows } = await req.db.query(
      `SELECT s.*,
              c.symbol as currency_symbol, c.name as currency_name,
              l.native_name as language_native, l.rtl as language_rtl
       FROM user_settings s
       LEFT JOIN supported_currencies c ON c.code = s.currency
       LEFT JOIN supported_languages  l ON l.code = s.language
       WHERE s.user_id = $1`,
      [req.user.id],
    );
    if (!rows.length) {
      const { rows: newRows } = await req.db.query(
        `INSERT INTO user_settings (user_id) VALUES ($1) RETURNING *`,
        [req.user.id],
      );
      return res.json({
        settings: { ...newRows[0], currency_symbol: "₦", language_rtl: false },
      });
    }
    return res.json({ settings: rows[0] });
  } catch (err) {
    console.error("[settings/getSettings]", err);
    return res.status(500).json({ error: "internal server error" });
  }
}

export async function updateSettings(req, res) {
  const {
    language,
    currency,
    theme,
    notifications_email,
    notifications_push,
    notifications_sms,
  } = req.body;
  const fields = [];
  const params = [];

  if (language !== undefined) {
    const { rows } = await req.db.query(
      `SELECT code FROM supported_languages WHERE code = $1 AND is_active = true`,
      [language],
    );
    if (!rows.length)
      return res.status(400).json({ error: "unsupported language" });
    params.push(language);
    fields.push(`language = $${params.length}`);
  }
  if (currency !== undefined) {
    const { rows } = await req.db.query(
      `SELECT code FROM supported_currencies WHERE code = $1 AND is_active = true`,
      [currency],
    );
    if (!rows.length)
      return res.status(400).json({ error: "unsupported currency" });
    params.push(currency);
    fields.push(`currency = $${params.length}`);
  }
  if (theme !== undefined) {
    if (!["light", "dark", "system"].includes(theme)) {
      return res
        .status(400)
        .json({ error: "theme must be light, dark, or system" });
    }
    params.push(theme);
    fields.push(`theme = $${params.length}`);
  }
  if (notifications_email !== undefined) {
    params.push(notifications_email);
    fields.push(`notifications_email = $${params.length}`);
  }
  if (notifications_push !== undefined) {
    params.push(notifications_push);
    fields.push(`notifications_push = $${params.length}`);
  }
  if (notifications_sms !== undefined) {
    params.push(notifications_sms);
    fields.push(`notifications_sms = $${params.length}`);
  }

  if (!fields.length)
    return res.status(400).json({ error: "no fields to update" });
  params.push(new Date(), req.user.id);

  try {
    const { rows } = await req.db.query(
      `INSERT INTO user_settings (user_id, ${fields.map((f) => f.split(" = ")[0]).join(", ")})
       VALUES ($${params.length}, ${fields.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (user_id) DO UPDATE
       SET ${fields.join(", ")}, updated_at = $${params.length - 1}
       RETURNING *`,
      params,
    );
    if (language) {
      await req.db.query(
        `UPDATE users SET language = $1, updated_at = now() WHERE id = $2`,
        [language, req.user.id],
      );
    }
    // At the end of updateSettings, before return res.json:
    try {
      const { safeDel } = await import("../config/redis.js");
      await safeDel(`user:${req.user.id}`);
    } catch {}
    return res.json({ settings: rows[0] });
  } catch (err) {
    console.error("[settings/updateSettings]", err);
    return res.status(500).json({ error: "internal server error" });
  }
}

export async function getLanguages(req, res) {
  try {
    const { rows } = await req.db.query(
      `SELECT code, name, native_name, rtl FROM supported_languages
       WHERE is_active = true ORDER BY name ASC`,
    );
    return res.json({ languages: rows });
  } catch (err) {
    return res.status(500).json({ error: "internal server error" });
  }
}

export async function getCurrencies(req, res) {
  try {
    const { rows } = await req.db.query(
      `SELECT code, name, symbol, paystack_supported, stripe_supported
       FROM supported_currencies
       WHERE is_active = true ORDER BY name ASC`,
    );
    return res.json({ currencies: rows });
  } catch (err) {
    return res.status(500).json({ error: "internal server error" });
  }
}

export async function translateText(req, res) {
  const { text, targetLang, sourceLang = "auto" } = req.body;
  if (!text || !targetLang) {
    return res.status(400).json({ error: "text and targetLang are required" });
  }
  try {
    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", sourceLang);
    url.searchParams.set("tl", targetLang);
    url.searchParams.set("dt", "t");
    url.searchParams.set("q", text);
    const response = await fetch(url.toString());
    const data = await response.json();
    const translated =
      data[0]?.map((chunk) => chunk?.[0] || "").join("") || text;
    return res.json({ translated, sourceLang, targetLang });
  } catch (err) {
    console.error("[settings/translateText]", err);
    return res.status(500).json({ error: "translation failed" });
  }
}
