// src/controllers/admin.controller.js
import { safeDel } from "../config/redis.js";
import { notify, notifyAdmins } from "../utils/notify.js";
import {
  sendEmail,
  sendDocumentReviewedEmail,
  sendBookingCancelledEmail,
} from "../utils/mailer.js";

// ── Audit log helper ──────────────────────────────────────────────────
async function auditLog(
  db,
  adminId,
  action,
  entityType,
  entityId,
  beforeData,
  afterData,
  req,
) {
  try {
    await db.query(
      `INSERT INTO admin_audit_log
         (admin_id, action, entity_type, entity_id, before_data, after_data, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        adminId,
        action,
        entityType,
        entityId || null,
        beforeData ? JSON.stringify(beforeData) : null,
        afterData ? JSON.stringify(afterData) : null,
        req?.headers?.["x-forwarded-for"]?.split(",")[0] ||
          req?.socket?.remoteAddress ||
          null,
      ],
    );
  } catch (err) {
    console.error("[auditLog] Failed:", err.message);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  DASHBOARD & STATS
// ══════════════════════════════════════════════════════════════════════

export const getStats = async (req, res) => {
  try {
    const [
      users,
      bookings,
      revenue,
      withdrawals,
      pendingPayments,
      activeSOS,
      pendingDocs,
      recentBookings,
      topMaids,
    ] = await Promise.all([
      // User counts by role + active status
      req.db.query(`
        SELECT role, is_active, COUNT(*) as count
        FROM users GROUP BY role, is_active
      `),
      // Booking counts by status
      req.db.query(`
        SELECT status, COUNT(*) as count FROM bookings GROUP BY status
      `),
      // Revenue breakdown
      req.db.query(`
        SELECT
          COALESCE(SUM(amount), 0)          AS total_gross,
          COALESCE(SUM(platform_fee), 0)    AS total_platform_fee,
          COALESCE(SUM(maid_payout), 0)     AS total_maid_payout,
          COUNT(*) FILTER (WHERE status = 'success')  AS paid_count,
          COUNT(*) FILTER (WHERE status = 'refunded') AS refunded_count
        FROM payments
      `),
      // Withdrawal summary
      req.db.query(`
        SELECT status, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
        FROM withdrawals GROUP BY status
      `),
      // Pending payment approvals
      req.db.query(`
        SELECT COUNT(*) as count FROM bookings
        WHERE status = 'pending'
      `),
      // Active SOS alerts
      req.db.query(`
        SELECT COUNT(*) as count FROM sos_alerts WHERE status = 'active'
      `),
      // Pending maid documents
      req.db.query(`
        SELECT COUNT(*) as count FROM maid_documents WHERE status = 'pending'
      `),
      // Recent bookings (last 7 days)
      req.db.query(`
        SELECT DATE(created_at) as date, COUNT(*) as count,
               COALESCE(SUM(total_amount), 0) as revenue
        FROM bookings
        WHERE created_at >= now() - INTERVAL '7 days'
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `),
      // Top 5 maids by earnings
      req.db.query(`
        SELECT u.id, u.name, u.avatar,
               mp.rating, mp.total_reviews,
               COALESCE(mw.total_earned, 0) as total_earned,
               COUNT(b.id) FILTER (WHERE b.status = 'completed') as completed_bookings
        FROM users u
        JOIN maid_profiles mp ON mp.user_id = u.id
        LEFT JOIN maid_wallets mw ON mw.maid_id = u.id
        LEFT JOIN bookings b ON b.maid_id = u.id
        WHERE u.role = 'maid' AND u.is_active = true
        GROUP BY u.id, u.name, u.avatar, mp.rating, mp.total_reviews, mw.total_earned
        ORDER BY total_earned DESC
        LIMIT 5
      `),
    ]);

    // Format user stats
    const userStats = {};
    for (const r of users.rows) {
      if (!userStats[r.role])
        userStats[r.role] = { total: 0, active: 0, inactive: 0 };
      userStats[r.role].total += Number(r.count);
      userStats[r.role][r.is_active ? "active" : "inactive"] += Number(r.count);
    }

    return res.json({
      users: userStats,
      bookings: Object.fromEntries(
        bookings.rows.map((r) => [r.status, Number(r.count)]),
      ),
      revenue: revenue.rows[0],
      withdrawals: withdrawals.rows,
      pending_approvals: Number(pendingPayments.rows[0].count),
      active_sos: Number(activeSOS.rows[0].count),
      pending_docs: Number(pendingDocs.rows[0].count),
      recent_bookings: recentBookings.rows,
      top_maids: topMaids.rows,
    });
  } catch (err) {
    console.error("[admin/getStats]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Revenue report ────────────────────────────────────────────────────
export const getRevenueReport = async (req, res) => {
  const { period = "monthly", date_from, date_to } = req.query;

  const from =
    date_from ||
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const to = date_to || new Date().toISOString().split("T")[0];

  const groupBy =
    {
      daily: "DATE(p.paid_at)",
      weekly: "DATE_TRUNC('week', p.paid_at)",
      monthly: "DATE_TRUNC('month', p.paid_at)",
    }[period] || "DATE_TRUNC('month', p.paid_at)";

  try {
    const { rows } = await req.db.query(
      `SELECT
         ${groupBy} as period,
         COUNT(*) as transactions,
         COALESCE(SUM(p.amount), 0) as gross_revenue,
         COALESCE(SUM(p.platform_fee), 0) as platform_fee,
         COALESCE(SUM(p.maid_payout), 0) as maid_payouts,
         COUNT(*) FILTER (WHERE p.gateway = 'paystack') as paystack_count,
         COUNT(*) FILTER (WHERE p.gateway = 'stripe')   as stripe_count,
         COUNT(*) FILTER (WHERE p.gateway = 'bank_transfer') as bank_count,
         COUNT(*) FILTER (WHERE p.gateway = 'crypto')   as crypto_count
       FROM payments p
       WHERE p.status = 'success'
         AND p.paid_at BETWEEN $1 AND $2
       GROUP BY 1
       ORDER BY 1 ASC`,
      [from, to],
    );

    const totals = rows.reduce(
      (acc, r) => ({
        gross: acc.gross + Number(r.gross_revenue),
        fee: acc.fee + Number(r.platform_fee),
        payouts: acc.payouts + Number(r.maid_payouts),
      }),
      { gross: 0, fee: 0, payouts: 0 },
    );

    return res.json({
      period,
      date_from: from,
      date_to: to,
      data: rows,
      totals,
    });
  } catch (err) {
    console.error("[admin/getRevenueReport]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ══════════════════════════════════════════════════════════════════════
//  USER MANAGEMENT
// ══════════════════════════════════════════════════════════════════════

export const listUsers = async (req, res) => {
  const {
    role,
    is_active,
    flagged,
    search,
    page = 1,
    limit = 50,
    sort_by = "created_at",
    sort_dir = "DESC",
  } = req.query;

  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];
  const params = [];

  if (role) {
    params.push(role);
    conditions.push(`u.role = $${params.length}`);
  }
  if (is_active !== undefined) {
    params.push(is_active === "true");
    conditions.push(`u.is_active = $${params.length}`);
  }
  if (flagged === "true") {
    conditions.push(`u.flagged = true`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`,
    );
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const safeSortBy = ["created_at", "name", "email", "role"].includes(sort_by)
    ? sort_by
    : "created_at";
  const safeSortDir = sort_dir === "ASC" ? "ASC" : "DESC";

  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT
         u.id, u.email, u.name, u.avatar, u.role, u.is_active,
         u.phone, u.country, u.language, u.email_verified,
         u.auth_provider, u.flagged, u.flag_reason, u.ban_reason,
         u.created_at, u.updated_at, u.last_seen_at,
         mp.rating, mp.total_reviews, mp.is_available, mp.id_verified,
         mw.available as wallet_balance,
         COUNT(b.id) FILTER (WHERE b.customer_id = u.id) as bookings_as_customer,
         COUNT(b.id) FILTER (WHERE b.maid_id = u.id)     as bookings_as_maid
       FROM users u
       LEFT JOIN maid_profiles mp ON mp.user_id = u.id AND u.role = 'maid'
       LEFT JOIN maid_wallets   mw ON mw.maid_id = u.id
       LEFT JOIN bookings b ON (b.customer_id = u.id OR b.maid_id = u.id)
       ${where}
       GROUP BY u.id, mp.rating, mp.total_reviews, mp.is_available,
                mp.id_verified, mw.available
       ORDER BY u.${safeSortBy} ${safeSortDir}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const { rows: countRows } = await req.db.query(
      `SELECT COUNT(*) FROM users u ${where}`,
      params.slice(0, -2),
    );

    return res.json({
      users: rows,
      total: Number(countRows[0].count),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    console.error("[admin/listUsers]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const getUser = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT
         u.*,
         mp.bio, mp.hourly_rate, mp.rating, mp.total_reviews,
         mp.is_available, mp.id_verified, mp.background_checked,
         mp.services, mp.location, mp.latitude, mp.longitude,
         mw.available as wallet_available,
         mw.pending   as wallet_pending,
         mw.total_earned, mw.total_withdrawn,
         (SELECT COUNT(*) FROM bookings WHERE customer_id = u.id) as total_bookings_customer,
         (SELECT COUNT(*) FROM bookings WHERE maid_id = u.id)     as total_bookings_maid,
         (SELECT COUNT(*) FROM reviews  WHERE maid_id = u.id)     as total_reviews_received,
         (SELECT COUNT(*) FROM withdrawals WHERE maid_id = u.id AND status = 'paid') as total_withdrawals
       FROM users u
       LEFT JOIN maid_profiles mp ON mp.user_id = u.id
       LEFT JOIN maid_wallets   mw ON mw.maid_id = u.id
       WHERE u.id = $1`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: "user not found" });
    return res.json({ user: rows[0] });
  } catch (err) {
    console.error("[admin/getUser]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const updateUser = async (req, res) => {
  const { is_active, role, admin_notes, flagged, flag_reason } = req.body;

  const fields = [];
  const params = [];

  if (is_active !== undefined) {
    params.push(is_active);
    fields.push(`is_active = $${params.length}`);
  }
  if (role !== undefined) {
    params.push(role);
    fields.push(`role = $${params.length}`);
  }
  if (admin_notes !== undefined) {
    params.push(admin_notes);
    fields.push(`admin_notes = $${params.length}`);
  }
  if (flagged !== undefined) {
    params.push(flagged);
    fields.push(`flagged = $${params.length}`);
  }
  if (flag_reason !== undefined) {
    params.push(flag_reason);
    fields.push(`flag_reason = $${params.length}`);
  }

  if (!fields.length)
    return res.status(400).json({ error: "no fields to update" });

  params.push(req.params.id);

  try {
    // Get before state for audit
    const { rows: before } = await req.db.query(
      `SELECT * FROM users WHERE id = $1`,
      [req.params.id],
    );
    if (!before.length)
      return res.status(404).json({ error: "user not found" });

    const { rows } = await req.db.query(
      `UPDATE users
       SET ${fields.join(", ")}, updated_at = now()
       WHERE id = $${params.length}
       RETURNING id, email, name, role, is_active, flagged, admin_notes`,
      params,
    );

    await safeDel(`user:${req.params.id}`);
    await auditLog(
      req.db,
      req.user.id,
      "update_user",
      "user",
      req.params.id,
      before[0],
      rows[0],
      req,
    );

    // Notify user if deactivated
    if (is_active === false) {
      await notify(req.db, {
        userId: req.params.id,
        type: "account_deactivated",
        title: "Account deactivated",
        body: "Your account has been deactivated by an administrator. Contact support for more information.",
        priority: "high",
        action_url: "/support",
      });
    }

    return res.json({ user: rows[0] });
  } catch (err) {
    console.error("[admin/updateUser]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const banUser = async (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: "ban reason is required" });

  // Prevent banning self
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "cannot ban yourself" });
  }

  try {
    const { rows } = await req.db.query(
      `UPDATE users
       SET is_active = false, flagged = true,
           ban_reason = $1, banned_at = now(), updated_at = now()
       WHERE id = $2
       RETURNING id, name, email, role`,
      [reason, req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: "user not found" });

    await safeDel(`user:${req.params.id}`);

    // Cancel all active bookings
    await req.db.query(
      `UPDATE bookings
       SET status = 'cancelled', cancelled_by = 'admin',
           cancelled_reason = $1, cancelled_at = now()
       WHERE (customer_id = $2 OR maid_id = $2)
         AND status NOT IN ('completed','cancelled')`,
      [`Account banned: ${reason}`, req.params.id],
    );

    await auditLog(
      req.db,
      req.user.id,
      "ban_user",
      "user",
      req.params.id,
      null,
      { reason },
      req,
    );

    await notify(req.db, {
      userId: req.params.id,
      type: "account_deactivated",
      title: "Account banned",
      body: `Your account has been suspended. Reason: ${reason}. Contact support to appeal.`,
      priority: "urgent",
      action_url: "/support",
    });

    return res.json({ message: "user banned", user: rows[0] });
  } catch (err) {
    console.error("[admin/banUser]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const unbanUser = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `UPDATE users
       SET is_active = true, flagged = false,
           ban_reason = null, banned_at = null, updated_at = now()
       WHERE id = $1
       RETURNING id, name, email, role`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: "user not found" });

    await safeDel(`user:${req.params.id}`);
    await auditLog(
      req.db,
      req.user.id,
      "unban_user",
      "user",
      req.params.id,
      null,
      null,
      req,
    );

    await notify(req.db, {
      userId: req.params.id,
      type: "system_announcement",
      title: "Account reinstated",
      body: "Your account has been reinstated. You can now use the platform again.",
      priority: "high",
    });

    return res.json({ message: "user unbanned", user: rows[0] });
  } catch (err) {
    console.error("[admin/unbanUser]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const deleteUser = async (req, res) => {
  const userId = req.params.id;

  if (userId === req.user.id) {
    return res.status(400).json({ error: "cannot delete your own account" });
  }

  try {
    const client = await req.db.connect();
    try {
      await client.query("BEGIN");

      const { rows: userRows } = await client.query(
        `SELECT id, role, name FROM users WHERE id = $1`,
        [userId],
      );
      if (!userRows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "user not found" });
      }

      const user = userRows[0];

      // Cancel active bookings
      await client.query(
        `UPDATE bookings
         SET status = 'cancelled', cancelled_by = 'admin',
             cancelled_reason = 'User account deleted', cancelled_at = now()
         WHERE (customer_id = $1 OR maid_id = $1)
           AND status NOT IN ('completed','cancelled')`,
        [userId],
      );

      if (user.role === "maid") {
        await client.query(`DELETE FROM maid_profiles  WHERE user_id = $1`, [
          userId,
        ]);
        await client.query(`DELETE FROM maid_documents WHERE maid_id  = $1`, [
          userId,
        ]);
        await client.query(`DELETE FROM maid_wallets   WHERE maid_id  = $1`, [
          userId,
        ]);
        await client.query(`DELETE FROM reviews        WHERE maid_id  = $1`, [
          userId,
        ]);
        await client.query(`DELETE FROM maid_availability WHERE maid_id = $1`, [
          userId,
        ]);
      }

      await client.query(`DELETE FROM emergency_contacts WHERE user_id = $1`, [
        userId,
      ]);
      await client.query(`DELETE FROM user_devices        WHERE user_id = $1`, [
        userId,
      ]);
      await client.query(`DELETE FROM user_settings       WHERE user_id = $1`, [
        userId,
      ]);
      await client.query(`DELETE FROM notifications       WHERE user_id = $1`, [
        userId,
      ]);
      await client.query(`DELETE FROM push_tokens         WHERE user_id = $1`, [
        userId,
      ]);
      await client.query(
        `DELETE FROM notification_preferences WHERE user_id = $1`,
        [userId],
      );
      await client.query(`DELETE FROM users               WHERE id      = $1`, [
        userId,
      ]);

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    await safeDel(`user:${userId}`);
    await auditLog(
      req.db,
      req.user.id,
      "delete_user",
      "user",
      userId,
      null,
      null,
      req,
    );

    return res.json({ message: "user deleted successfully" });
  } catch (err) {
    console.error("[admin/deleteUser]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Impersonate user (read-only JWT for debugging) ────────────────────
export const impersonateUser = async (req, res) => {
  const { rows } = await req.db.query(
    `SELECT id, email, name, role FROM users WHERE id = $1 AND is_active = true`,
    [req.params.id],
  );
  if (!rows.length) return res.status(404).json({ error: "user not found" });

  // Log the impersonation
  await auditLog(
    req.db,
    req.user.id,
    "impersonate_user",
    "user",
    req.params.id,
    null,
    null,
    req,
  );

  // Return a short-lived token (1 hour max)
  const jwt = await import("jsonwebtoken");
  const token = jwt.default.sign(
    {
      id: rows[0].id,
      email: rows[0].email,
      role: rows[0].role,
      impersonated_by: req.user.id,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

  return res.json({
    token,
    user: rows[0],
    note: "Token expires in 1 hour. For debugging only.",
  });
};

// ══════════════════════════════════════════════════════════════════════
//  BOOKING MANAGEMENT
// ══════════════════════════════════════════════════════════════════════

export const listBookings = async (req, res) => {
  const {
    status,
    maid_id,
    customer_id,
    date_from,
    date_to,
    search,
    page = 1,
    limit = 50,
  } = req.query;

  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`b.status = $${params.length}`);
  }
  if (maid_id) {
    params.push(maid_id);
    conditions.push(`b.maid_id = $${params.length}`);
  }
  if (customer_id) {
    params.push(customer_id);
    conditions.push(`b.customer_id = $${params.length}`);
  }
  if (date_from) {
    params.push(date_from);
    conditions.push(`b.service_date >= $${params.length}`);
  }
  if (date_to) {
    params.push(date_to);
    conditions.push(`b.service_date <= $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(c.name ILIKE $${params.length} OR m.name ILIKE $${params.length} OR b.address ILIKE $${params.length})`,
    );
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT b.*,
              c.name as customer_name, c.email as customer_email,
              c.avatar as customer_avatar, c.phone as customer_phone,
              m.name as maid_name, m.email as maid_email,
              m.avatar as maid_avatar,
              p.status as payment_status, p.gateway, p.amount as payment_amount,
              p.platform_fee, p.maid_payout, p.paid_at,
              (SELECT COUNT(*) FROM sos_alerts WHERE booking_id = b.id AND status = 'active') as active_sos
       FROM bookings b
       JOIN users c ON c.id = b.customer_id
       JOIN users m ON m.id = b.maid_id
       LEFT JOIN payments p ON p.booking_id = b.id
       ${where}
       ORDER BY b.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const { rows: countRows } = await req.db.query(
      `SELECT COUNT(*) FROM bookings b
       JOIN users c ON c.id = b.customer_id
       JOIN users m ON m.id = b.maid_id
       ${where}`,
      params.slice(0, -2),
    );

    return res.json({
      bookings: rows,
      total: Number(countRows[0].count),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    console.error("[admin/listBookings]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const getBooking = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT b.*,
              c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
              m.name as maid_name, m.email as maid_email, m.phone as maid_phone,
              p.status as payment_status, p.gateway, p.amount as payment_amount,
              p.platform_fee, p.maid_payout, p.paid_at, p.paystack_reference,
              p.stripe_payment_id, p.bank_transfer_ref
       FROM bookings b
       JOIN users c ON c.id = b.customer_id
       JOIN users m ON m.id = b.maid_id
       LEFT JOIN payments p ON p.booking_id = b.id
       WHERE b.id = $1`,
      [req.params.id],
    );
    if (!rows.length)
      return res.status(404).json({ error: "booking not found" });

    // Get SOS alerts for this booking
    const { rows: sos } = await req.db.query(
      `SELECT sa.*, u.name as triggered_by_name
       FROM sos_alerts sa JOIN users u ON u.id = sa.triggered_by
       WHERE sa.booking_id = $1 ORDER BY sa.created_at DESC`,
      [req.params.id],
    );

    // Get location history
    const { rows: locations } = await req.db.query(
      `SELECT lat, lng, recorded_at FROM booking_locations
       WHERE booking_id = $1 ORDER BY recorded_at DESC LIMIT 50`,
      [req.params.id],
    );

    return res.json({
      booking: rows[0],
      sos_alerts: sos,
      location_history: locations,
    });
  } catch (err) {
    console.error("[admin/getBooking]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const adminUpdateBookingStatus = async (req, res) => {
  const { status, reason } = req.body;
  const validStatuses = [
    "awaiting_payment",
    "pending",
    "confirmed",
    "in_progress",
    "completed",
    "cancelled",
  ];

  if (!validStatuses.includes(status)) {
    return res
      .status(400)
      .json({ error: `status must be one of: ${validStatuses.join(", ")}` });
  }

  try {
    const { rows: before } = await req.db.query(
      `SELECT * FROM bookings WHERE id = $1`,
      [req.params.id],
    );
    if (!before.length)
      return res.status(404).json({ error: "booking not found" });

    const extraFields =
      status === "cancelled"
        ? `, cancelled_by = 'admin', cancelled_reason = '${reason || "Admin action"}', cancelled_at = now()`
        : "";

    const { rows } = await req.db.query(
      `UPDATE bookings
       SET status = $1, updated_at = now() ${extraFields}
       WHERE id = $2 RETURNING *`,
      [status, req.params.id],
    );

    await auditLog(
      req.db,
      req.user.id,
      "update_booking_status",
      "booking",
      req.params.id,
      { status: before[0].status },
      { status },
      req,
    );

    // Notify both parties
    const { rows: parties } = await req.db.query(
      `SELECT u.id, u.name, u.email FROM users u
       WHERE u.id = $1 OR u.id = $2`,
      [before[0].customer_id, before[0].maid_id],
    );

    for (const party of parties) {
      await notify(req.db, {
        userId: party.id,
        type: "booking_" + status,
        title: `Booking ${status}`,
        body: `Your booking has been marked as ${status} by an administrator.${reason ? ` Reason: ${reason}` : ""}`,
        priority: "high",
        action_url: `/bookings/${req.params.id}`,
        data: { booking_id: req.params.id },
      });
    }

    return res.json({ booking: rows[0] });
  } catch (err) {
    console.error("[admin/adminUpdateBookingStatus]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ══════════════════════════════════════════════════════════════════════
//  MAID DOCUMENT REVIEW
// ══════════════════════════════════════════════════════════════════════

export const listPendingDocuments = async (req, res) => {
  const { status = "pending", page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  try {
    const { rows } = await req.db.query(
      `SELECT md.*, u.name as maid_name, u.email as maid_email, u.avatar as maid_avatar
       FROM maid_documents md
       JOIN users u ON u.id = md.maid_id
       WHERE md.status = $1
       ORDER BY md.submitted_at ASC
       LIMIT $2 OFFSET $3`,
      [status, Number(limit), offset],
    );
    return res.json({ documents: rows });
  } catch (err) {
    console.error("[admin/listPendingDocuments]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const reviewDocument = async (req, res) => {
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
       WHERE id = $3 RETURNING *`,
      [status, admin_notes || null, req.params.docId],
    );
    if (!rows.length)
      return res.status(404).json({ error: "document not found" });

    if (status === "approved") {
      await req.db.query(
        `UPDATE maid_profiles SET id_verified = true WHERE user_id = $1`,
        [rows[0].maid_id],
      );
    }

    // Get maid details for notification + email
    const { rows: maidRows } = await req.db.query(
      `SELECT name, email FROM users WHERE id = $1`,
      [rows[0].maid_id],
    );
    const maid = maidRows[0];

    await notify(req.db, {
      userId: rows[0].maid_id,
      type: status === "approved" ? "document_approved" : "document_rejected",
      title: `Document ${status}`,
      body:
        status === "approved"
          ? `Your ${rows[0].doc_type.replace(/_/g, " ")} has been approved. Your profile is now verified.`
          : `Your ${rows[0].doc_type.replace(/_/g, " ")} was rejected. ${admin_notes || "Please re-upload."}`,
      priority: status === "rejected" ? "high" : "normal",
      action_url: "/maid/profile",
      data: { doc_type: rows[0].doc_type },
      sendMail: () =>
        sendDocumentReviewedEmail(maid, rows[0].doc_type, status, admin_notes),
    });

    await auditLog(
      req.db,
      req.user.id,
      `document_${status}`,
      "maid_document",
      req.params.docId,
      null,
      { status, admin_notes },
      req,
    );

    return res.json({ document: rows[0] });
  } catch (err) {
    console.error("[admin/reviewDocument]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ══════════════════════════════════════════════════════════════════════
//  SOS ALERTS
// ══════════════════════════════════════════════════════════════════════

export const getSOSAlerts = async (req, res) => {
  const { status = "active", page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  try {
    const { rows } = await req.db.query(
      `SELECT sa.*,
              u.name as triggered_by_name, u.role as triggered_by_role,
              b.service_date, b.address as booking_address, b.status as booking_status,
              c.name as customer_name, c.phone as customer_phone,
              m.name as maid_name,     m.phone as maid_phone,
              ru.name as resolved_by_name
       FROM sos_alerts sa
       JOIN users u ON u.id = sa.triggered_by
       JOIN bookings b ON b.id = sa.booking_id
       JOIN users c ON c.id = b.customer_id
       JOIN users m ON m.id = b.maid_id
       LEFT JOIN users ru ON ru.id = sa.resolved_by
       WHERE sa.status = $1
       ORDER BY sa.created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, Number(limit), offset],
    );

    const { rows: counts } = await req.db.query(
      `SELECT status, COUNT(*) FROM sos_alerts GROUP BY status`,
    );

    return res.json({ alerts: rows, summary: counts });
  } catch (err) {
    console.error("[admin/getSOSAlerts]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const resolveSOSAlert = async (req, res) => {
  const { notes } = req.body;
  try {
    const { rows } = await req.db.query(
      `UPDATE sos_alerts
       SET status = 'resolved', resolved_by = $1,
           resolved_at = now(), message = COALESCE($2, message)
       WHERE id = $3 AND status = 'active'
       RETURNING *`,
      [req.user.id, notes || null, req.params.alertId],
    );
    if (!rows.length) {
      return res
        .status(404)
        .json({ error: "alert not found or already resolved" });
    }

    // Notify both parties
    const { rows: bookingRows } = await req.db.query(
      `SELECT customer_id, maid_id FROM bookings WHERE id = $1`,
      [rows[0].booking_id],
    );
    if (bookingRows.length) {
      const { customer_id, maid_id } = bookingRows[0];
      for (const userId of [customer_id, maid_id]) {
        await notify(req.db, {
          userId,
          type: "sos_resolved",
          title: "SOS alert resolved",
          body: "The SOS alert for your booking has been resolved by an administrator.",
          priority: "high",
          action_url: `/bookings/${rows[0].booking_id}`,
        });
      }
    }

    await auditLog(
      req.db,
      req.user.id,
      "resolve_sos",
      "booking",
      rows[0].booking_id,
      null,
      { notes },
      req,
    );

    return res.json({ alert: rows[0] });
  } catch (err) {
    console.error("[admin/resolveSOSAlert]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ══════════════════════════════════════════════════════════════════════
//  PLATFORM SETTINGS
// ══════════════════════════════════════════════════════════════════════

export const getPlatformSettings = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT key, value, description, updated_at FROM platform_settings ORDER BY key ASC`,
    );
    // Convert to object for easy frontend consumption
    const settings = Object.fromEntries(
      rows.map((r) => [
        r.key,
        {
          value: r.value,
          description: r.description,
          updated_at: r.updated_at,
        },
      ]),
    );
    return res.json({ settings });
  } catch (err) {
    console.error("[admin/getPlatformSettings]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const updatePlatformSetting = async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;

  if (value === undefined)
    return res.status(400).json({ error: "value is required" });

  try {
    const { rows } = await req.db.query(
      `INSERT INTO platform_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE
       SET value = $2, updated_by = $3, updated_at = now()
       RETURNING *`,
      [key, JSON.stringify(value), req.user.id],
    );

    await auditLog(
      req.db,
      req.user.id,
      "update_setting",
      "platform",
      null,
      null,
      { key, value },
      req,
    );

    return res.json({ setting: rows[0] });
  } catch (err) {
    console.error("[admin/updatePlatformSetting]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ══════════════════════════════════════════════════════════════════════
//  AUDIT LOG
// ══════════════════════════════════════════════════════════════════════

export const getAuditLog = async (req, res) => {
  const {
    admin_id,
    entity_type,
    action,
    date_from,
    date_to,
    page = 1,
    limit = 50,
  } = req.query;

  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];
  const params = [];

  if (admin_id) {
    params.push(admin_id);
    conditions.push(`al.admin_id = $${params.length}`);
  }
  if (entity_type) {
    params.push(entity_type);
    conditions.push(`al.entity_type = $${params.length}`);
  }
  if (action) {
    params.push(action);
    conditions.push(`al.action = $${params.length}`);
  }
  if (date_from) {
    params.push(date_from);
    conditions.push(`al.created_at >= $${params.length}`);
  }
  if (date_to) {
    params.push(date_to);
    conditions.push(`al.created_at <= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT al.*, u.name as admin_name, u.email as admin_email
       FROM admin_audit_log al
       JOIN users u ON u.id = al.admin_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return res.json({ logs: rows });
  } catch (err) {
    console.error("[admin/getAuditLog]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ══════════════════════════════════════════════════════════════════════
//  SUPPORT TICKETS OVERVIEW
// ══════════════════════════════════════════════════════════════════════

export const getSupportOverview = async (req, res) => {
  try {
    const [customerTickets, maidTickets] = await Promise.all([
      req.db.query(`
        SELECT status, priority, COUNT(*) as count
        FROM customer_support_tickets GROUP BY status, priority
      `),
      req.db.query(`
        SELECT status, priority, COUNT(*) as count
        FROM maid_support_tickets GROUP BY status, priority
      `),
    ]);

    return res.json({
      customer_tickets: customerTickets.rows,
      maid_tickets: maidTickets.rows,
    });
  } catch (err) {
    console.error("[admin/getSupportOverview]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ══════════════════════════════════════════════════════════════════════
//  MAID MANAGEMENT
// ══════════════════════════════════════════════════════════════════════

export const listMaids = async (req, res) => {
  const {
    is_available,
    id_verified,
    flagged,
    search,
    page = 1,
    limit = 20,
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const conditions = ["u.role = 'maid'"];
  const params = [];

  if (is_available !== undefined) {
    params.push(is_available === "true");
    conditions.push(`mp.is_available = $${params.length}`);
  }
  if (id_verified !== undefined) {
    params.push(id_verified === "true");
    conditions.push(`mp.id_verified = $${params.length}`);
  }
  if (flagged === "true") conditions.push(`u.flagged = true`);
  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR mp.location ILIKE $${params.length})`,
    );
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT DISTINCT ON (u.id)
              u.id, u.name, u.email, u.avatar, u.is_active, u.flagged,
              u.phone, u.country, u.created_at,
              mp.hourly_rate, mp.rating, mp.total_reviews, mp.is_available,
              mp.id_verified, mp.background_checked, mp.services, mp.location,
              mp.currency, mp.rate_hourly, mp.rate_daily,
              mp.rate_weekly, mp.rate_monthly, mp.rate_custom, mp.pricing_note,
              mw.available as wallet_balance, mw.total_earned,
              (SELECT COUNT(*) FROM bookings WHERE maid_id = u.id AND status = 'completed') as completed_bookings,
              (SELECT COUNT(*) FROM maid_documents WHERE maid_id = u.id AND status = 'pending') as pending_docs
       FROM users u
       JOIN maid_profiles mp ON mp.user_id = u.id
       LEFT JOIN maid_wallets mw ON mw.maid_id = u.id
       ${where}
       ORDER BY u.id, u.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return res.json({ maids: rows });
  } catch (err) {
    console.error("[admin/listMaids]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const updateMaid = async (req, res) => {
  const {
    bio,
    hourly_rate,
    is_available,
    services,
    location,
    id_verified,
    background_checked,
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
  if (is_available !== undefined) {
    params.push(is_available);
    fields.push(`is_available = $${params.length}`);
  }
  if (services !== undefined) {
    params.push(services);
    fields.push(`services = $${params.length}`);
  }
  if (location !== undefined) {
    params.push(location);
    fields.push(`location = $${params.length}`);
  }
  if (id_verified !== undefined) {
    params.push(id_verified);
    fields.push(`id_verified = $${params.length}`);
  }
  if (background_checked !== undefined) {
    params.push(background_checked);
    fields.push(`background_checked = $${params.length}`);
  }

  if (!fields.length)
    return res.status(400).json({ error: "no fields to update" });

  params.push(req.params.id);

  try {
    const { rows } = await req.db.query(
      `UPDATE maid_profiles SET ${fields.join(", ")}, updated_at = now()
       WHERE user_id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows.length)
      return res.status(404).json({ error: "maid profile not found" });

    await auditLog(
      req.db,
      req.user.id,
      "update_maid_profile",
      "user",
      req.params.id,
      null,
      req.body,
      req,
    );

    return res.json({ profile: rows[0] });
  } catch (err) {
    console.error("[admin/updateMaid]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ══════════════════════════════════════════════════════════════════════
//  WITHDRAW & PAYMENT OVERVIEWS (Thin wrappers — detail in own controllers)
// ══════════════════════════════════════════════════════════════════════

export const getFinancialOverview = async (req, res) => {
  try {
    const [payments, payouts, withdrawals, escrow] = await Promise.all([
      req.db.query(`
        SELECT gateway, status, COUNT(*) as count,
               COALESCE(SUM(amount), 0) as total
        FROM payments GROUP BY gateway, status
      `),
      req.db.query(`
        SELECT status, COUNT(*) as count,
               COALESCE(SUM(amount), 0) as total
        FROM maid_payouts GROUP BY status
      `),
      req.db.query(`
        SELECT method, status, COUNT(*) as count,
               COALESCE(SUM(amount), 0) as total
        FROM withdrawals GROUP BY method, status
      `),
      req.db.query(`
        SELECT COALESCE(SUM(available), 0) as total_available,
               COALESCE(SUM(pending), 0)   as total_pending,
               COALESCE(SUM(total_earned), 0) as total_earned,
               COALESCE(SUM(total_withdrawn), 0) as total_withdrawn
        FROM maid_wallets
      `),
    ]);

    return res.json({
      payments: payments.rows,
      payouts: payouts.rows,
      withdrawals: withdrawals.rows,
      wallet_totals: escrow.rows[0],
    });
  } catch (err) {
    console.error("[admin/getFinancialOverview]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
