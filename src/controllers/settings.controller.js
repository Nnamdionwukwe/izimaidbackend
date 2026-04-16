// src/controllers/settings.controller.js

// ─── Get current user settings ───────────────────────────────────────
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

    // Auto-create settings row if it doesn't exist yet
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

// ─── Update settings ─────────────────────────────────────────────────
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
    // Validate language exists
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
      `INSERT INTO user_settings (user_id, ${fields.map((f, i) => f.split(" = ")[0]).join(", ")})
       VALUES ($${params.length}, ${fields.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (user_id) DO UPDATE
       SET ${fields.join(", ")}, updated_at = $${params.length - 1}
       RETURNING *`,
      params,
    );

    // Also update language/country on users table for quick access
    if (language) {
      await req.db.query(
        `UPDATE users SET language = $1, updated_at = now() WHERE id = $2`,
        [language, req.user.id],
      );
    }

    return res.json({ settings: rows[0] });
  } catch (err) {
    console.error("[settings/updateSettings]", err);
    return res.status(500).json({ error: "internal server error" });
  }
}

// ─── Get all supported languages ─────────────────────────────────────
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

// ─── Get all supported currencies ────────────────────────────────────
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

// ─── Translate text via Google Translate free endpoint ───────────────
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

    // Google returns nested arrays — flatten to string
    const translated =
      data[0]?.map((chunk) => chunk?.[0] || "").join("") || text;

    return res.json({ translated, sourceLang, targetLang });
  } catch (err) {
    console.error("[settings/translateText]", err);
    return res.status(500).json({ error: "translation failed" });
  }
}
