// src/utils/notify.js
// Central notification dispatcher — handles in-app + email + push (future)
// Used by ALL controllers — never call sendEmail directly from controllers,

// always go through notify() so preferences are respected

// Notification type → preference column mapping
const TYPE_TO_PREF = {
  // Bookings
  booking_created: "bookings",
  booking_confirmed: "bookings",
  booking_cancelled: "bookings",
  booking_completed: "bookings",
  booking_reminder: "bookings",
  booking_checkin: "bookings",
  booking_checkout: "bookings",
  booking_approved: "bookings",
  booking_rejected: "bookings",
  booking_video_call: "bookings",

  // Payments
  payment_received: "payments",
  payment_receipt: "payments",
  payment_refund: "payments",
  payment_failed: "payments",
  bank_transfer_verified: "payments",

  // Messages
  new_message: "messages",
  support_message: "messages",

  // Reviews
  review_received: "reviews",
  review_reminder: "reviews",

  // Withdrawals
  withdrawal_requested: "withdrawals",
  withdrawal_processing: "withdrawals",
  withdrawal_paid: "withdrawals",
  withdrawal_rejected: "withdrawals",
  withdrawal_failed: "withdrawals",
  withdrawal_cancelled: "withdrawals",
  withdrawal_admin_alert: "withdrawals",

  // Support tickets
  ticket_created: "support",
  ticket_reply: "support",
  ticket_status: "support",
  ticket_resolved: "support",

  // Security / Auth
  new_login: "system",
  password_changed: "system",
  email_verified: "system",
  account_deactivated: "system",

  // Documents
  document_submitted: "system",
  document_approved: "system",
  document_rejected: "system",

  // SOS
  sos_triggered: "system",
  sos_resolved: "system",

  // System / Admin
  system_announcement: "system",
  platform_update: "system",
  maintenance: "system",

  // Promotions
  promotion: "promotions",
  new_feature: "promotions",
};

// Get user notification preferences
async function getPrefs(db, userId) {
  try {
    const { rows } = await db.query(
      `SELECT * FROM notification_preferences WHERE user_id = $1`,
      [userId],
    );
    if (rows.length) return rows[0];

    // Auto-create default preferences
    const { rows: created } = await db.query(
      `INSERT INTO notification_preferences (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING *`,
      [userId],
    );
    return created[0];
  } catch {
    return null; // If prefs fail, allow notification through
  }
}

// Check if user wants this notification on this channel
function prefAllowed(prefs, type, channel) {
  if (!prefs) return true;
  const category = TYPE_TO_PREF[type] || "system";
  const key = `${channel}_${category}`;
  // Only block if explicitly set to false — undefined/null means allow
  return prefs[key] !== false;
}

// ── Core notify function ──────────────────────────────────────────────
export async function notify(
  db,
  {
    userId,
    type,
    title,
    body,
    data = {},
    priority = "normal",
    action_url = null,
    image_url = null,
    expires_at = null,
    sendMail,
    sendPush,
  },
) {
  try {
    const prefs = await getPrefs(db, userId);

    if (prefAllowed(prefs, type, "inapp")) {
      await db.query(
        `INSERT INTO notifications (user_id, type, title, body, data, priority, action_url, image_url, expires_at, channel)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'in_app')`,
        [
          userId,
          type,
          title,
          body,
          JSON.stringify(data),
          priority,
          action_url,
          image_url,
          expires_at,
        ],
      );
    }

    // ← This stays INSIDE notify, with the improved error logging:
    if (sendMail && prefAllowed(prefs, type, "email")) {
      Promise.resolve()
        .then(() => sendMail())
        .catch((err) => {
          console.error(
            `[notify] ✗ Email FAILED type="${type}" userId="${userId}":`,
            err.message,
          );
          console.error(err.stack);
        });
    }

    if (sendPush && prefAllowed(prefs, type, "push")) {
      sendPush().catch((err) =>
        console.error(`[notify] Push failed for ${type}:`, err.message),
      );
    }
  } catch (err) {
    console.error(
      `[notify] Failed for user ${userId} type ${type}:`,
      err.message,
    );
  }
}

// ── Notify multiple users ─────────────────────────────────────────────
export async function notifyMany(db, userIds, notifData) {
  await Promise.allSettled(
    userIds.map((userId) => notify(db, { ...notifData, userId })),
  );
}

// ── Notify all admins ─────────────────────────────────────────────────
export async function notifyAdmins(db, notifData) {
  try {
    const { rows } = await db.query(
      `SELECT id FROM users WHERE role = 'admin' AND is_active = true`,
    );
    await Promise.allSettled(
      rows.map((admin) => notify(db, { ...notifData, userId: admin.id })),
    );
  } catch (err) {
    console.error("[notifyAdmins] Failed:", err.message);
  }
}

// ── Notify booking participants (both customer + maid) ────────────────
export async function notifyBookingParties(db, booking, notifData) {
  await Promise.allSettled([
    notify(db, { ...notifData, userId: booking.customer_id }),
    notify(db, { ...notifData, userId: booking.maid_id }),
  ]);
}
