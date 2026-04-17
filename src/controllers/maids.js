import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
import { safeSet, safeDel } from "../config/redis.js";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const listMaids = async (req, res) => {
  const {
    location,
    service,
    min_rate,
    max_rate,
    lat,
    lng,
    radius_km = 50, // ← geo params
    rate_type, // ← 'hourly','daily','weekly','monthly'
    page = 1,
    limit = 20,
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const conditions = ["mp.is_available = true", "u.is_active = true"];
  const params = [];

  if (location) {
    params.push(`%${location}%`);
    conditions.push(`mp.location ILIKE $${params.length}`);
  }
  if (service) {
    params.push(service);
    conditions.push(`$${params.length} = ANY(mp.services)`);
  }
  if (min_rate) {
    params.push(Number(min_rate));
    conditions.push(`mp.hourly_rate >= $${params.length}`);
  }
  if (max_rate) {
    params.push(Number(max_rate));
    conditions.push(`mp.hourly_rate <= $${params.length}`);
  }
  // Geo filter — only if lat+lng provided
  if (lat && lng) {
    params.push(Number(lat), Number(lng), Number(radius_km));
    conditions.push(
      `(6371 * acos(cos(radians($${params.length - 2})) * cos(radians(mp.latitude)) *
        cos(radians(mp.longitude) - radians($${params.length - 1})) +
        sin(radians($${params.length - 2})) * sin(radians(mp.latitude)))) <= $${params.length}`,
    );
  }

  const where = conditions.join(" AND ");
  const filterParams = [...params];
  params.push(Number(limit), offset);

  // Distance expression for ORDER BY (null-safe)
  const distanceExpr =
    lat && lng
      ? `(6371 * acos(cos(radians(${Number(lat)})) * cos(radians(mp.latitude)) *
        cos(radians(mp.longitude) - radians(${Number(lng)})) +
        sin(radians(${Number(lat)})) * sin(radians(mp.latitude))))`
      : "NULL";

  try {
    const { rows } = await req.db.query(
      `SELECT u.id, u.name, u.avatar,
              mp.bio, mp.hourly_rate, mp.years_exp, mp.services,
              mp.location, mp.rating, mp.total_reviews, mp.currency,
              mp.rate_hourly, mp.rate_daily, mp.rate_weekly, mp.rate_monthly,
              mp.rate_custom, mp.pricing_note, mp.latitude, mp.longitude,
              mp.id_verified, mp.background_checked, mp.languages,
              ${distanceExpr} AS distance_km
       FROM maid_profiles mp
       JOIN users u ON u.id = mp.user_id
       WHERE ${where}
       ORDER BY ${lat && lng ? "distance_km ASC NULLS LAST," : ""} mp.rating DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const { rows: countRows } = await req.db.query(
      `SELECT COUNT(*) FROM maid_profiles mp
       JOIN users u ON u.id = mp.user_id
       WHERE ${where}`,
      filterParams,
    );

    return res.json({
      maids: rows,
      total: Number(countRows[0].count),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    console.error("[maids.controller/listMaids]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const getMaid = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT u.id, u.name, u.avatar, u.created_at as member_since,
              mp.bio, mp.hourly_rate, mp.years_exp, mp.services,
              mp.location, mp.is_available, mp.rating, mp.total_reviews,
              mp.rate_hourly, mp.rate_daily, mp.rate_weekly, mp.rate_monthly,
              mp.rate_custom, mp.pricing_note, mp.currency,
              mp.latitude, mp.longitude, mp.languages, mp.max_distance_km,
              mp.id_verified, mp.background_checked
       FROM maid_profiles mp
       JOIN users u ON u.id = mp.user_id
       WHERE u.id = $1 AND u.is_active = true`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: "maid not found" });
    return res.json({ maid: rows[0] });
  } catch (err) {
    console.error("[maids.controller/getMaid]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const updateProfile = async (req, res) => {
  const {
    bio,
    hourly_rate,
    years_exp,
    services,
    location,
    is_available,
    rate_hourly,
    rate_daily,
    rate_weekly,
    rate_monthly,
    rate_custom,
    pricing_note,
    latitude,
    longitude,
    currency,
    languages,
    max_distance_km,
  } = req.body;

  const fields = [];
  const params = [];

  if (bio !== undefined) {
    params.push(bio);
    fields.push(`bio = $${params.length}`);
  }
  if (hourly_rate !== undefined) {
    params.push(hourly_rate);
    fields.push(`hourly_rate = $${params.length}`);
  }
  if (years_exp !== undefined) {
    params.push(years_exp);
    fields.push(`years_exp = $${params.length}`);
  }
  if (services !== undefined) {
    params.push(services);
    fields.push(`services = $${params.length}`);
  }
  if (location !== undefined) {
    params.push(location);
    fields.push(`location = $${params.length}`);
  }
  if (is_available !== undefined) {
    params.push(is_available);
    fields.push(`is_available = $${params.length}`);
  }
  if (rate_hourly !== undefined) {
    params.push(rate_hourly);
    fields.push(`rate_hourly = $${params.length}`);
  }
  if (rate_daily !== undefined) {
    params.push(rate_daily);
    fields.push(`rate_daily = $${params.length}`);
  }
  if (rate_weekly !== undefined) {
    params.push(rate_weekly);
    fields.push(`rate_weekly = $${params.length}`);
  }
  if (rate_monthly !== undefined) {
    params.push(rate_monthly);
    fields.push(`rate_monthly = $${params.length}`);
  }
  if (pricing_note !== undefined) {
    params.push(pricing_note);
    fields.push(`pricing_note = $${params.length}`);
  }
  if (latitude !== undefined) {
    params.push(latitude);
    fields.push(`latitude = $${params.length}`);
  }
  if (longitude !== undefined) {
    params.push(longitude);
    fields.push(`longitude = $${params.length}`);
  }
  if (currency !== undefined) {
    params.push(currency);
    fields.push(`currency = $${params.length}`);
  }
  if (max_distance_km !== undefined) {
    params.push(max_distance_km);
    fields.push(`max_distance_km = $${params.length}`);
  }
  if (rate_custom !== undefined) {
    params.push(JSON.stringify(rate_custom));
    fields.push(`rate_custom = $${params.length}`);
  }
  if (languages !== undefined) {
    params.push(languages);
    fields.push(`languages = $${params.length}`);
  }

  if (!fields.length)
    return res.status(400).json({ error: "no fields to update" });

  // ← user_id param MUST be last
  params.push(req.user.id);

  try {
    const { rows } = await req.db.query(
      `UPDATE maid_profiles SET ${fields.join(", ")}, updated_at = now()
       WHERE user_id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows.length)
      return res.status(404).json({ error: "profile not found" });
    return res.json({ profile: rows[0] });
  } catch (err) {
    console.error("[maids.controller/updateProfile]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const getMaidReviews = async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  try {
    const { rows } = await req.db.query(
      `SELECT r.id, r.rating, r.comment, r.created_at,
              u.name as customer_name, u.avatar as customer_avatar
       FROM reviews r
       JOIN users u ON u.id = r.customer_id
       WHERE r.maid_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, Number(limit), offset],
    );

    return res.json({ reviews: rows });
  } catch (err) {
    console.error("[maids.controller/getMaidReviews]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const uploadAvatar = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "izimaid/avatars",
          public_id: `user_${req.user.id}`,
          overwrite: true,
          transformation: [
            { width: 400, height: 400, crop: "fill", gravity: "face" },
            { quality: "auto", fetch_format: "auto" },
          ],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        },
      );
      streamifier.createReadStream(req.file.buffer).pipe(stream);
    });

    const avatar_url = uploadResult.secure_url;

    const { rows } = await req.db.query(
      `UPDATE users SET avatar = $1 WHERE id = $2 RETURNING id, name, email, avatar, role`,
      [avatar_url, req.user.id],
    );

    if (!rows.length) return res.status(404).json({ error: "user not found" });

    // ✅ Bust the Redis cache so every device gets fresh data on next /me call
    await safeDel(`user:${req.user.id}`);

    return res.json({
      message: "Avatar uploaded successfully",
      avatar_url: rows[0].avatar,
    });
  } catch (err) {
    console.error("[maids.controller/uploadAvatar]", err);
    return res.status(500).json({ error: "Failed to upload avatar" });
  }
};

export const adminUpdateMaid = async (req, res) => {
  const { bio, hourly_rate, years_exp, services, location, is_available } =
    req.body;

  const fields = [];
  const params = [];

  if (bio !== undefined) {
    params.push(bio);
    fields.push(`bio = $${params.length}`);
  }
  if (hourly_rate !== undefined) {
    params.push(hourly_rate);
    fields.push(`hourly_rate = $${params.length}`);
  }
  if (years_exp !== undefined) {
    params.push(years_exp);
    fields.push(`years_exp = $${params.length}`);
  }
  if (services !== undefined) {
    params.push(services);
    fields.push(`services = $${params.length}`);
  }
  if (location !== undefined) {
    params.push(location);
    fields.push(`location = $${params.length}`);
  }
  if (is_available !== undefined) {
    params.push(is_available);
    fields.push(`is_available = $${params.length}`);
  }

  if (!fields.length)
    return res.status(400).json({ error: "no fields to update" });

  params.push(req.params.id);

  try {
    const { rows } = await req.db.query(
      `UPDATE maid_profiles SET ${fields.join(", ")}
       WHERE user_id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows.length)
      return res.status(404).json({ error: "profile not found" });
    return res.json({ profile: rows[0] });
  } catch (err) {
    console.error("[maids.controller/adminUpdateMaid]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const adminDeactivateMaid = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `UPDATE users SET is_active = false
       WHERE id = $1 AND role = 'maid' RETURNING id, name, is_active`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: "maid not found" });
    return res.json({ message: "maid deactivated", user: rows[0] });
  } catch (err) {
    console.error("[maids.controller/adminDeactivateMaid]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const adminActivateMaid = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `UPDATE users SET is_active = true
       WHERE id = $1 AND role = 'maid' RETURNING id, name, is_active`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: "maid not found" });
    return res.json({ message: "maid activated", user: rows[0] });
  } catch (err) {
    console.error("[maids.controller/adminActivateMaid]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const adminDeleteReview = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `DELETE FROM reviews WHERE id = $1 AND maid_id = $2 RETURNING id`,
      [req.params.reviewId, req.params.id],
    );
    if (!rows.length)
      return res.status(404).json({ error: "review not found" });
    return res.json({ message: "review deleted" });
  } catch (err) {
    console.error("[maids.controller/adminDeleteReview]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const adminListMaids = async (req, res) => {
  const {
    location,
    service,
    min_rate,
    max_rate,
    page = 1,
    limit = 20,
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const conditions = [];
  const params = [];

  if (location) {
    params.push(`%${location}%`);
    conditions.push(`mp.location ILIKE $${params.length}`);
  }
  if (service) {
    params.push(service);
    conditions.push(`$${params.length} = ANY(mp.services)`);
  }
  if (min_rate) {
    params.push(Number(min_rate));
    conditions.push(`mp.hourly_rate >= $${params.length}`);
  }
  if (max_rate) {
    params.push(Number(max_rate));
    conditions.push(`mp.hourly_rate <= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const filterParams = [...params];
  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT DISTINCT ON (u.id)
              u.id, u.name, u.avatar, u.is_active,
              mp.bio, mp.hourly_rate, mp.years_exp,
              mp.services, mp.location, mp.rating,
              mp.total_reviews, mp.is_available
       FROM maid_profiles mp
       JOIN users u ON u.id = mp.user_id
       ${where}
       ORDER BY u.id, mp.rating DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const { rows: countRows } = await req.db.query(
      `SELECT COUNT(*) FROM (
         SELECT DISTINCT ON (u.id) u.id
         FROM maid_profiles mp
         JOIN users u ON u.id = mp.user_id
         ${where}
         ORDER BY u.id
       ) sub`,
      filterParams,
    );

    return res.json({
      maids: rows,
      total: Number(countRows[0].count),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    console.error("[maids.controller/adminListMaids]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── Get nearby maids (dedicated endpoint) ───────────────────────────
export const getNearbyMaids = async (req, res) => {
  const { lat, lng, radius_km = 20, limit = 10 } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: "lat and lng are required" });
  }

  try {
    const { rows } = await req.db.query(
      `SELECT u.id, u.name, u.avatar,
              mp.hourly_rate, mp.rate_hourly, mp.rate_daily,
              mp.services, mp.location, mp.rating, mp.total_reviews,
              mp.currency, mp.id_verified,
              (6371 * acos(
                cos(radians($1)) * cos(radians(mp.latitude)) *
                cos(radians(mp.longitude) - radians($2)) +
                sin(radians($1)) * sin(radians(mp.latitude))
              )) AS distance_km
       FROM maid_profiles mp
       JOIN users u ON u.id = mp.user_id
       WHERE mp.is_available = true
         AND u.is_active = true
         AND mp.latitude IS NOT NULL
         AND mp.longitude IS NOT NULL
         AND (6371 * acos(
               cos(radians($1)) * cos(radians(mp.latitude)) *
               cos(radians(mp.longitude) - radians($2)) +
               sin(radians($1)) * sin(radians(mp.latitude))
             )) <= $3
       ORDER BY distance_km ASC
       LIMIT $4`,
      [Number(lat), Number(lng), Number(radius_km), Number(limit)],
    );

    return res.json({ maids: rows, count: rows.length });
  } catch (err) {
    console.error("[maids.controller/getNearbyMaids]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── Get maid availability slots ────────────────────────────────────
export const getMaidAvailability = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT id, day_of_week, start_time, end_time, is_active
       FROM maid_availability
       WHERE maid_id = $1
       ORDER BY day_of_week ASC, start_time ASC`,
      [req.params.id],
    );
    return res.json({ availability: rows });
  } catch (err) {
    console.error("[maids.controller/getMaidAvailability]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ADD this new function alongside getMaidAvailability:
export const getMyAvailability = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT id, day_of_week, start_time, end_time, is_active
       FROM maid_availability
       WHERE maid_id = $1          -- ← req.user.id, not req.params.id
       ORDER BY day_of_week ASC, start_time ASC`,
      [req.user.id],
    );
    return res.json({ availability: rows });
  } catch (err) {
    console.error("[maids.controller/getMyAvailability]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── Set maid availability (replace all slots) ──────────────────────
// Body: { slots: [{ day_of_week: 1, start_time: "09:00", end_time: "17:00" }] }
export const setMaidAvailability = async (req, res) => {
  const { slots } = req.body;

  if (!Array.isArray(slots)) {
    return res.status(400).json({ error: "slots must be an array" });
  }

  // Validate each slot
  for (const s of slots) {
    if (s.day_of_week < 0 || s.day_of_week > 6) {
      return res
        .status(400)
        .json({ error: "day_of_week must be 0-6 (Sun-Sat)" });
    }
    if (!s.start_time || !s.end_time) {
      return res
        .status(400)
        .json({ error: "start_time and end_time are required" });
    }
  }

  try {
    // Delete existing and re-insert — simplest approach
    await req.db.query(`DELETE FROM maid_availability WHERE maid_id = $1`, [
      req.user.id,
    ]);

    if (slots.length > 0) {
      const valuePlaceholders = slots
        .map((_, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`)
        .join(", ");
      const values = [req.user.id];
      slots.forEach((s) => {
        values.push(s.day_of_week, s.start_time, s.end_time);
      });

      await req.db.query(
        `INSERT INTO maid_availability (maid_id, day_of_week, start_time, end_time)
         VALUES ${valuePlaceholders}`,
        values,
      );
    }

    return res.json({ message: "Availability updated", count: slots.length });
  } catch (err) {
    console.error("[maids.controller/setMaidAvailability]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── Upload identity document ─────────────────────────────────────────
export const uploadMaidDocument = async (req, res) => {
  const { doc_type } = req.body;
  const validTypes = [
    "national_id",
    "passport",
    "utility_bill",
    "drivers_license",
  ];

  if (!doc_type || !validTypes.includes(doc_type)) {
    return res.status(400).json({
      error: `doc_type must be one of: ${validTypes.join(", ")}`,
    });
  }
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  try {
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "deusizi/documents",
          public_id: `doc_${req.user.id}_${doc_type}_${Date.now()}`,
          resource_type: "image",
          transformation: [{ quality: "auto" }],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        },
      );
      streamifier.createReadStream(req.file.buffer).pipe(stream);
    });

    // Upsert — one document per type per maid
    const { rows } = await req.db.query(
      `INSERT INTO maid_documents (maid_id, doc_type, doc_url, status, submitted_at)
       VALUES ($1, $2, $3, 'pending', now())
       ON CONFLICT (maid_id, doc_type)
       DO UPDATE SET doc_url = $3, status = 'pending', submitted_at = now(), reviewed_at = null
       RETURNING *`,
      [req.user.id, doc_type, uploadResult.secure_url],
    );

    return res.status(201).json({
      message: "Document submitted for review",
      document: rows[0],
    });
  } catch (err) {
    console.error("[maids.controller/uploadMaidDocument]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── Get own documents ────────────────────────────────────────────────
export const getMaidDocuments = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT id, doc_type, doc_url, status, admin_notes, submitted_at, reviewed_at
       FROM maid_documents WHERE maid_id = $1 ORDER BY submitted_at DESC`,
      [req.user.id],
    );
    return res.json({ documents: rows });
  } catch (err) {
    console.error("[maids.controller/getMaidDocuments]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── Admin: review a document ─────────────────────────────────────────
export const adminReviewDocument = async (req, res) => {
  const { status, admin_notes } = req.body;
  if (!["approved", "rejected"].includes(status)) {
    return res
      .status(400)
      .json({ error: "status must be approved or rejected" });
  }

  try {
    const { rows } = await req.db.query(
      `UPDATE maid_documents
       SET status = $1, admin_notes = $2, reviewed_at = now()
       WHERE id = $3
       RETURNING *`,
      [status, admin_notes || null, req.params.docId],
    );

    if (!rows.length)
      return res.status(404).json({ error: "document not found" });

    // If approved, mark maid as id_verified
    if (status === "approved") {
      await req.db.query(
        `UPDATE maid_profiles SET id_verified = true WHERE user_id = $1`,
        [rows[0].maid_id],
      );
    }

    return res.json({ document: rows[0] });
  } catch (err) {
    console.error("[maids.controller/adminReviewDocument]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
