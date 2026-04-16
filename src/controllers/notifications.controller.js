// src/controllers/notifications.controller.js

// ── Get notifications for logged-in user ─────────────────────────────
export const getNotifications = async (req, res) => {
  const {
    page = 1,
    limit = 20,
    unread, // ?unread=true → only unread
    type, // ?type=booking_confirmed
    priority, // ?priority=high
  } = req.query;

  const offset = (Number(page) - 1) * Number(limit);
  const conditions = ["n.user_id = $1"];
  const params = [req.user.id];

  if (unread === "true") {
    conditions.push("n.is_read = false");
  }
  if (type) {
    params.push(type);
    conditions.push(`n.type = $${params.length}`);
  }
  if (priority) {
    params.push(priority);
    conditions.push(`n.priority = $${params.length}`);
  }
  // Hide expired notifications
  conditions.push(`(n.expires_at IS NULL OR n.expires_at > now())`);

  const where = `WHERE ${conditions.join(" AND ")}`;
  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT n.id, n.type, n.title, n.body, n.data, n.is_read,
              n.read_at, n.priority, n.action_url, n.image_url,
              n.created_at
       FROM notifications n
       ${where}
       ORDER BY n.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    // Unread count
    const { rows: countRows } = await req.db.query(
      `SELECT COUNT(*) as total,
              COUNT(*) FILTER (WHERE is_read = false) as unread
       FROM notifications
       WHERE user_id = $1
         AND (expires_at IS NULL OR expires_at > now())`,
      [req.user.id],
    );

    return res.json({
      notifications: rows,
      total: Number(countRows[0].total),
      unread: Number(countRows[0].unread),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    console.error("[notifications/getNotifications]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Get unread count only (for nav badge) ─────────────────────────────
export const getUnreadCount = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT COUNT(*) as count FROM notifications
       WHERE user_id = $1
         AND is_read = false
         AND (expires_at IS NULL OR expires_at > now())`,
      [req.user.id],
    );
    return res.json({ count: Number(rows[0].count) });
  } catch (err) {
    console.error("[notifications/getUnreadCount]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Mark one notification as read ─────────────────────────────────────
export const markAsRead = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `UPDATE notifications
       SET is_read = true, read_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [req.params.id, req.user.id],
    );

    if (!rows.length) {
      return res.status(404).json({ error: "notification not found" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[notifications/markAsRead]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Mark ALL notifications as read ───────────────────────────────────
export const markAllAsRead = async (req, res) => {
  try {
    const { rowCount } = await req.db.query(
      `UPDATE notifications
       SET is_read = true, read_at = now()
       WHERE user_id = $1 AND is_read = false`,
      [req.user.id],
    );

    return res.json({ success: true, marked: rowCount });
  } catch (err) {
    console.error("[notifications/markAllAsRead]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Mark specific types as read ───────────────────────────────────────
export const markTypeAsRead = async (req, res) => {
  const { type } = req.params;
  try {
    const { rowCount } = await req.db.query(
      `UPDATE notifications
       SET is_read = true, read_at = now()
       WHERE user_id = $1 AND type = $2 AND is_read = false`,
      [req.user.id, type],
    );
    return res.json({ success: true, marked: rowCount });
  } catch (err) {
    console.error("[notifications/markTypeAsRead]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Delete one notification ───────────────────────────────────────────
export const deleteNotification = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `DELETE FROM notifications
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [req.params.id, req.user.id],
    );

    if (!rows.length) {
      return res.status(404).json({ error: "notification not found" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[notifications/deleteNotification]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Delete all read notifications ─────────────────────────────────────
export const deleteAllRead = async (req, res) => {
  try {
    const { rowCount } = await req.db.query(
      `DELETE FROM notifications
       WHERE user_id = $1 AND is_read = true`,
      [req.user.id],
    );
    return res.json({ success: true, deleted: rowCount });
  } catch (err) {
    console.error("[notifications/deleteAllRead]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Get notification preferences ──────────────────────────────────────
export const getPreferences = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT * FROM notification_preferences WHERE user_id = $1`,
      [req.user.id],
    );

    if (!rows.length) {
      // Auto-create defaults
      const { rows: created } = await req.db.query(
        `INSERT INTO notification_preferences (user_id)
         VALUES ($1) ON CONFLICT (user_id)
         DO UPDATE SET user_id = EXCLUDED.user_id
         RETURNING *`,
        [req.user.id],
      );
      return res.json({ preferences: created[0] });
    }

    return res.json({ preferences: rows[0] });
  } catch (err) {
    console.error("[notifications/getPreferences]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Update notification preferences ──────────────────────────────────
export const updatePreferences = async (req, res) => {
  const allowed = [
    "inapp_bookings",
    "inapp_payments",
    "inapp_messages",
    "inapp_reviews",
    "inapp_withdrawals",
    "inapp_support",
    "inapp_system",
    "inapp_promotions",
    "email_bookings",
    "email_payments",
    "email_messages",
    "email_reviews",
    "email_withdrawals",
    "email_support",
    "email_system",
    "email_promotions",
    "push_bookings",
    "push_payments",
    "push_messages",
    "push_reviews",
    "push_withdrawals",
    "push_support",
    "push_system",
    "push_promotions",
    "sms_bookings",
    "sms_payments",
    "sms_security",
    "quiet_hours_enabled",
    "quiet_hours_start",
    "quiet_hours_end",
    "quiet_hours_timezone",
  ];

  const fields = [];
  const params = [];

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      params.push(req.body[key]);
      fields.push(`${key} = $${params.length}`);
    }
  }

  if (!fields.length) {
    return res.status(400).json({ error: "no valid fields to update" });
  }

  params.push(req.user.id);

  try {
    const { rows } = await req.db.query(
      `INSERT INTO notification_preferences (user_id, ${fields.map((f) => f.split(" = ")[0]).join(", ")})
       VALUES ($${params.length}, ${fields.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (user_id) DO UPDATE
       SET ${fields.join(", ")}, updated_at = now()
       RETURNING *`,
      params,
    );
    return res.json({ preferences: rows[0] });
  } catch (err) {
    console.error("[notifications/updatePreferences]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Register push token (for future mobile app) ───────────────────────
export const registerPushToken = async (req, res) => {
  const { token, platform = "web", device_id } = req.body;
  if (!token) return res.status(400).json({ error: "token is required" });

  try {
    await req.db.query(
      `INSERT INTO push_tokens (user_id, token, platform, device_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, token)
       DO UPDATE SET is_active = true, updated_at = now(), platform = $3`,
      [req.user.id, token, platform, device_id || null],
    );
    return res.json({ success: true });
  } catch (err) {
    console.error("[notifications/registerPushToken]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Deregister push token (logout / disable push) ────────────────────
export const deregisterPushToken = async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "token is required" });

  try {
    await req.db.query(
      `UPDATE push_tokens SET is_active = false, updated_at = now()
       WHERE user_id = $1 AND token = $2`,
      [req.user.id, token],
    );
    return res.json({ success: true });
  } catch (err) {
    console.error("[notifications/deregisterPushToken]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── ADMIN: Send announcement to all users ────────────────────────────
export const adminSendAnnouncement = async (req, res) => {
  const { title, body, role, priority = "normal", action_url } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: "title and body are required" });
  }

  try {
    const params = [];
    let roleFilter = "";

    if (role && ["customer", "maid"].includes(role)) {
      params.push(role);
      roleFilter = `AND role = $${params.length}`;
    }

    const { rows: users } = await req.db.query(
      `SELECT id FROM users WHERE is_active = true ${roleFilter}`,
      params,
    );

    if (!users.length) {
      return res.json({ message: "no users to notify", count: 0 });
    }

    // Bulk insert — much faster than individual notify() calls
    const values = users
      .map((u, i) => {
        const base = i * 6;
        return `($${base + 1},'system_announcement',$${base + 2},$${base + 3},'{}','${priority}','${action_url || ""}','in_app')`;
      })
      .join(", ");

    const flat = users.flatMap((u) => [u.id, title, body]);

    await req.db.query(
      `INSERT INTO notifications
         (user_id, type, title, body, data, priority, action_url, channel)
       VALUES ${values}`,
      flat,
    );

    return res.json({
      message: "Announcement sent",
      count: users.length,
      role: role || "all",
    });
  } catch (err) {
    console.error("[notifications/adminSendAnnouncement]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── ADMIN: Send notification to specific user ─────────────────────────
export const adminSendToUser = async (req, res) => {
  const {
    user_id,
    title,
    body,
    type = "system_announcement",
    priority = "normal",
    action_url,
    data = {},
  } = req.body;

  if (!user_id || !title || !body) {
    return res
      .status(400)
      .json({ error: "user_id, title and body are required" });
  }

  try {
    const { rows: user } = await req.db.query(
      `SELECT id FROM users WHERE id = $1 AND is_active = true`,
      [user_id],
    );
    if (!user.length) return res.status(404).json({ error: "user not found" });

    await req.db.query(
      `INSERT INTO notifications
         (user_id, type, title, body, data, priority, action_url, channel)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'in_app')`,
      [
        user_id,
        type,
        title,
        body,
        JSON.stringify(data),
        priority,
        action_url || null,
      ],
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("[notifications/adminSendToUser]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── ADMIN: Get all notifications with filters ─────────────────────────
export const adminGetNotifications = async (req, res) => {
  const { user_id, type, is_read, priority, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];
  const params = [];

  if (user_id) {
    params.push(user_id);
    conditions.push(`n.user_id = $${params.length}`);
  }
  if (type) {
    params.push(type);
    conditions.push(`n.type = $${params.length}`);
  }
  if (priority) {
    params.push(priority);
    conditions.push(`n.priority = $${params.length}`);
  }
  if (is_read !== undefined) {
    params.push(is_read === "true");
    conditions.push(`n.is_read = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT n.*, u.name as user_name, u.role as user_role
       FROM notifications n
       JOIN users u ON u.id = n.user_id
       ${where}
       ORDER BY n.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const { rows: stats } = await req.db.query(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE is_read = false) as unread,
         COUNT(*) FILTER (WHERE priority = 'urgent') as urgent
       FROM notifications`,
    );

    return res.json({ notifications: rows, stats: stats[0] });
  } catch (err) {
    console.error("[notifications/adminGetNotifications]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── ADMIN: Delete old notifications (cleanup) ─────────────────────────
export const adminCleanupNotifications = async (req, res) => {
  const { days_old = 90 } = req.body;

  try {
    const { rowCount } = await req.db.query(
      `DELETE FROM notifications
       WHERE is_read = true
         AND created_at < now() - INTERVAL '${Number(days_old)} days'`,
    );
    return res.json({
      message: `Deleted ${rowCount} old notifications`,
      deleted: rowCount,
    });
  } catch (err) {
    console.error("[notifications/adminCleanupNotifications]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
