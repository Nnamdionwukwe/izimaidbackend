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
  if (!prefs) return true; // Default allow if prefs unavailable
  const category = TYPE_TO_PREF[type] || "system";
  const key = `${channel}_${category}`;
  return prefs[key] !== false; // Default true if column doesn't exist
}

// ── Core notify function ──────────────────────────────────────────────
// src/utils/notify.js — replace the core notify function only

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
  const prefs = await getPrefs(db, userId);

  // ── In-app notification — isolated try/catch so it never blocks email ──
  if (prefAllowed(prefs, type, "inapp")) {
    try {
      await db.query(
        `INSERT INTO notifications
           (user_id, type, title, body, data, priority, action_url, image_url, expires_at, channel)
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
    } catch (err) {
      // Log but DO NOT return — email must still fire
      console.error(
        `[notify] In-app insert failed for ${type} user ${userId}:`,
        err.message,
      );
    }
  }

  // ── Email — runs regardless of whether in-app succeeded ──────────────
  if (sendMail && prefAllowed(prefs, type, "email")) {
    try {
      await sendMail(); // ← await instead of fire-and-forget so errors surface
    } catch (err) {
      console.error(
        `[notify] Email failed for ${type} user ${userId}:`,
        err.message,
      );
    }
  }

  // ── Push (future) ────────────────────────────────────────────────────
  if (sendPush && prefAllowed(prefs, type, "push")) {
    sendPush().catch((err) =>
      console.error(`[notify] Push failed for ${type}:`, err.message),
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
// src/utils/notify.js — replace notifyAdmins only

export async function notifyAdmins(db, { sendMail, ...notifData }) {
  try {
    const { rows } = await db.query(
      `SELECT id FROM users WHERE role = 'admin' AND is_active = true`,
    );

    // In-app notifications — one per admin, no email passed here
    await Promise.allSettled(
      rows.map((admin) => notify(db, { ...notifData, userId: admin.id })),
    );

    // Email — fire ONCE for all admins (the sendMail fn already loops internally)
    if (typeof sendMail === "function") {
      try {
        await sendMail();
      } catch (err) {
        console.error("[notifyAdmins] Email failed:", err.message);
      }
    }
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
