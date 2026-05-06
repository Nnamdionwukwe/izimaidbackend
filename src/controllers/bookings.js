import {
  sendBookingConfirmation,
  sendBookingCancelledEmail,
  sendNewBookingToMaid,
  transporter,
} from "../utils/mailer.js";
import crypto from "crypto";
import { notify, notifyMany, notifyAdmins } from "../utils/notify.js";

// ─── Helper: get full booking with users ─────────────────────────────
async function fetchBookingWithUsers(db, bookingId) {
  const { rows } = await db.query(
    `SELECT b.*,
            c.name as customer_name, c.email as customer_email,
            c.avatar as customer_avatar, c.phone as customer_phone,
            m.name as maid_name, m.email as maid_email,
            m.avatar as maid_avatar,
            mp.currency AS maid_currency,           -- ← ADD
            p.status as payment_status, p.paystack_reference,
            p.stripe_payment_id, p.amount as payment_amount,
            p.currency AS payment_currency          -- ← ADD
     FROM bookings b
     JOIN users c ON c.id = b.customer_id
     JOIN users m ON m.id = b.maid_id
     LEFT JOIN maid_profiles mp ON mp.user_id = b.maid_id   -- ← ADD
     LEFT JOIN payments p ON p.booking_id = b.id
     WHERE b.id = $1`,
    [bookingId],
  );
  return rows[0] || null;
}

// ─── Create booking ───────────────────────────────────────────────────
export const createBooking = async (req, res) => {
  // ADD duration_qty to the destructuring:
  const {
    maid_id,
    service_date,
    duration_hours,
    duration_qty, // ← ADD: raw count of days/weeks/months
    address,
    notes,
    rate_type = "hourly",
    total_override,
  } = req.body;

  if (!maid_id || !service_date || !duration_hours || !address) {
    return res.status(400).json({
      error: "maid_id, service_date, duration_hours, address are required",
    });
  }

  const validRateTypes = ["hourly", "daily", "weekly", "monthly", "custom"];
  if (!validRateTypes.includes(rate_type)) {
    return res.status(400).json({
      error: `rate_type must be one of: ${validRateTypes.join(", ")}`,
    });
  }

  try {
    const { rows: maidRows } = await req.db.query(
      `SELECT mp.hourly_rate, mp.rate_hourly, mp.rate_daily, mp.rate_weekly,
              mp.rate_monthly, mp.rate_custom, mp.is_available,
              u.is_active, u.name AS maid_name, u.email AS maid_email
       FROM maid_profiles mp
       JOIN users u ON u.id = mp.user_id
       WHERE mp.user_id = $1`,
      [maid_id],
    );

    if (!maidRows.length) {
      return res.status(404).json({ error: "maid not found" });
    }

    const maid = maidRows[0];

    if (!maid.is_available || !maid.is_active) {
      return res.status(409).json({ error: "maid is not available" });
    }

    // ── Calculate total ───────────────────────────────────────────
    // ── Calculate total ───────────────────────────────────────────
    let rate = 0;
    switch (rate_type) {
      case "hourly":
        rate = Number(maid.rate_hourly || maid.hourly_rate || 0);
        break;
      case "daily":
        rate = Number(maid.rate_daily || 0);
        break;
      case "weekly":
        rate = Number(maid.rate_weekly || 0);
        break;
      case "monthly":
        rate = Number(maid.rate_monthly || 0);
        break;
      case "custom":
        // rate_custom is JSONB { "Deep Clean": 5000 } — take first value if no label match
        if (maid.rate_custom && typeof maid.rate_custom === "object") {
          const values = Object.values(maid.rate_custom);
          rate = Number(values[0] || 0);
        }
        break;
    }

    let total_amount;

    if (total_override && Number(total_override) > 0) {
      // Negotiated — exact agreed price
      total_amount = Number(total_override);
    } else {
      if (rate === 0) {
        return res.status(400).json({
          error: `maid has not set a ${rate_type} rate`,
        });
      }

      const qty = Number(duration_qty || 1);

      // Hourly multiplies by hours; all others multiply by the raw unit count
      if (rate_type === "hourly") {
        total_amount = rate * Number(duration_hours);
      } else {
        // daily × days, weekly × weeks, monthly × months, custom × sessions
        total_amount = rate * qty;
      }
    }
    // ── Insert — only columns that exist in the bookings table ────
    const { rows } = await req.db.query(
      `INSERT INTO bookings
         (customer_id, maid_id, service_date, duration_hours,
          address, notes, total_amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'awaiting_payment')
       RETURNING *`,
      [
        req.user.id,
        maid_id,
        service_date,
        Number(duration_hours),
        address,
        notes || null,
        total_amount,
      ],
    );

    return res.status(201).json({ booking: rows[0] });
  } catch (err) {
    console.error("[bookings/createBooking]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── List bookings ────────────────────────────────────────────────────
export const listBookings = async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];
  const params = [];

  if (req.user.role === "customer") {
    params.push(req.user.id);
    conditions.push(`b.customer_id = $${params.length}`);
  }
  if (req.user.role === "maid") {
    params.push(req.user.id);
    conditions.push(`b.maid_id = $${params.length}`);
    conditions.push(`b.status NOT IN ('awaiting_payment')`);
  }
  if (status) {
    params.push(status);
    conditions.push(`b.status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT DISTINCT ON (b.id)
         b.id, b.status, b.service_date, b.duration_hours,
         b.total_amount, b.address, b.notes, b.created_at, b.updated_at,
         c.name   AS customer_name,
         c.avatar AS customer_avatar,
         m.id     AS maid_id,
         m.name   AS maid_name,
         m.avatar AS maid_avatar,
         mp.currency AS maid_currency,
         p.status    AS payment_status,
         p.currency  AS payment_currency
       FROM bookings b
       JOIN users c ON c.id = b.customer_id
       JOIN users m ON m.id = b.maid_id
       LEFT JOIN maid_profiles mp ON mp.user_id = b.maid_id
       LEFT JOIN payments p ON p.booking_id = b.id AND p.status = 'success'
       ${where}
       ORDER BY b.id, b.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return res.json({ bookings: rows });
  } catch (err) {
    console.error("[bookings/listBookings]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── Get single booking ───────────────────────────────────────────────
export const getBooking = async (req, res) => {
  try {
    const booking = await fetchBookingWithUsers(req.db, req.params.id);
    if (!booking) return res.status(404).json({ error: "booking not found" });

    const isOwner =
      booking.customer_id === req.user.id || booking.maid_id === req.user.id;
    if (!isOwner && req.user.role !== "admin") {
      return res.status(403).json({ error: "forbidden" });
    }

    // ── Attach emergency contacts (shown during active/in_progress jobs) ──
    let emergencyContacts = [];
    if (["confirmed", "in_progress"].includes(booking.status)) {
      const { rows: ec } = await req.db.query(
        `SELECT ec.name, ec.phone, ec.email, ec.relationship
 FROM emergency_contacts ec
 WHERE ec.user_id = $1
 ORDER BY ec.is_primary DESC`,
        // Show the OTHER party's emergency contacts
        [
          req.user.id === booking.customer_id
            ? booking.maid_id
            : booking.customer_id,
        ],
      );
      emergencyContacts = ec;
    }

    // ── Latest location (in_progress only) ────────────────────────
    // Replace the latestLocation block in getBooking:
    let latestLocation = null;
    if (["confirmed", "in_progress", "completed"].includes(booking.status)) {
      const { rows: locRows } = await req.db.query(
        `SELECT lat, lng, recorded_at FROM booking_locations
     WHERE booking_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
        [booking.id],
      );
      latestLocation = locRows[0] || null;
    }

    // ── Active SOS (admin + both parties see) ─────────────────────
    const { rows: sosRows } = await req.db.query(
      `SELECT sa.*, u.name as triggered_by_name
       FROM sos_alerts sa
       JOIN users u ON u.id = sa.triggered_by
       WHERE sa.booking_id = $1 AND sa.status = 'active'`,
      [booking.id],
    );

    const { rows: reviewRows } = await req.db.query(
      `SELECT r.rating, r.comment, r.created_at, u.name AS customer_name
   FROM reviews r
   JOIN users u ON u.id = r.customer_id
   WHERE r.booking_id = $1
   LIMIT 1`,
      [booking.id],
    );

    return res.json({
      booking,
      emergency_contacts: emergencyContacts,
      latest_location: latestLocation,
      active_sos: sosRows,
      review: reviewRows[0] || null,
    });
  } catch (err) {
    console.error("[bookings/getBooking]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── Update status ────────────────────────────────────────────────────
export const updateStatus = async (req, res) => {
  const { status, reason } = req.body;

  const validTransitions = {
    customer: ["cancelled"],
    maid: ["confirmed", "in_progress", "completed"],
    admin: [
      "awaiting_payment",
      "pending",
      "confirmed",
      "in_progress",
      "completed",
      "cancelled",
    ],
  };

  if (!validTransitions[req.user.role]?.includes(status)) {
    return res.status(400).json({
      error: `invalid status transition for role ${req.user.role}`,
    });
  }

  try {
    let extraFields = "";
    let extraParams = [];

    if (status === "confirmed") {
      extraFields = ", maid_accepted_at = now()";
    }
    if (status === "cancelled") {
      extraFields = `, cancelled_by = '${req.user.role}', cancelled_reason = $5, cancelled_at = now()`;
      extraParams = [reason || null];
    }

    const queryParams = [
      status,
      req.params.id,
      req.user.id,
      req.user.role,
      ...extraParams,
    ];

    const { rows } = await req.db.query(
      `UPDATE bookings
       SET status = $1, updated_at = now() ${extraFields}
       WHERE id = $2 AND (customer_id = $3 OR maid_id = $3 OR $4 = 'admin')
       RETURNING *`,
      queryParams,
    );

    if (!rows.length) {
      return res
        .status(404)
        .json({ error: "booking not found or not authorized" });
    }

    const booking = rows[0]; // ← booking defined HERE, AFTER the query

    // ── Credit maid wallet when booking completes ─────────────────
    if (status === "completed") {
      try {
        const { creditMaidWallet } = await import("./wallet.controller.js");

        // Get currency from payment or maid profile
        const { rows: payRows } = await req.db.query(
          `SELECT p.currency AS payment_currency, mp.currency AS maid_currency
           FROM bookings b
           LEFT JOIN payments p ON p.booking_id = b.id AND p.status = 'success'
           LEFT JOIN maid_profiles mp ON mp.user_id = b.maid_id
           WHERE b.id = $1`,
          [booking.id],
        );
        const currency =
          payRows[0]?.payment_currency || payRows[0]?.maid_currency || "NGN";
        const maidPayout = Number(booking.total_amount) * 0.9;

        await creditMaidWallet(req.db, {
          maidId: booking.maid_id,
          currency,
          amount: maidPayout,
          description: `Booking payment`,
          bookingId: booking.id,
        });
      } catch (walletErr) {
        // Never crash the status update over wallet issues
        console.error(
          "[updateStatus] wallet credit failed:",
          walletErr.message,
        );
      }
    }

    // ── Fetch both users for emails ───────────────────────────────
    const { rows: userRows } = await req.db.query(
      `SELECT u.id, u.name, u.email, u.role FROM users u
       WHERE u.id = $1 OR u.id = $2`,
      [booking.customer_id, booking.maid_id],
    );
    const customer = userRows.find((u) => u.id === booking.customer_id);
    const maid = userRows.find((u) => u.id === booking.maid_id);

    if (status === "confirmed" && customer && maid) {
      sendBookingConfirmation(customer, booking, maid).catch(console.error);
      sendNewBookingToMaid(maid, booking, customer).catch(console.error);
    }
    if (status === "cancelled") {
      const cancelledByName =
        req.user.role === "customer"
          ? customer?.name
          : req.user.role === "maid"
            ? maid?.name
            : "Admin";
      if (customer)
        sendBookingCancelledEmail(customer, booking, cancelledByName).catch(
          console.error,
        );
      if (maid)
        sendBookingCancelledEmail(maid, booking, cancelledByName).catch(
          console.error,
        );
    }

    return res.json({ booking });
  } catch (err) {
    console.error("[bookings/updateStatus]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── GPS Check-in ─────────────────────────────────────────────────────
export const checkIn = async (req, res) => {
  const { lat, lng } = req.body; // optional — GPS may fail on some devices

  try {
    const { rows } = await req.db.query(
      `UPDATE bookings
       SET checkin_at = now(),
           checkin_lat = $1,
           checkin_lng = $2,
           live_tracking_on = true,
           status = 'in_progress',
           updated_at = now()
       WHERE id = $3 AND maid_id = $4
         AND status = 'confirmed'
       RETURNING *`,
      [lat || null, lng || null, req.params.id, req.user.id],
    );

    if (!rows.length) {
      return res.status(404).json({
        error: "Booking not found, not authorized, or not in confirmed status",
      });
    }

    if (lat && lng) {
      try {
        await req.db.query(
          `INSERT INTO booking_locations (booking_id, maid_id, lat, lng)
           VALUES ($1, $2, $3, $4)`,
          [req.params.id, req.user.id, lat, lng],
        );
      } catch {}
    }

    await notify(req.db, {
      userId: rows[0].customer_id,
      type: "booking_checkin",
      title: "🟢 Maid has arrived",
      body: "Your maid checked in and has started the job.",
      data: { booking_id: req.params.id },
      action_url: `/bookings/${req.params.id}`,
    });

    return res.json({
      message: "Checked in successfully",
      booking: rows[0],
      checkin: { lat: lat || null, lng: lng || null, at: new Date() },
    });
  } catch (err) {
    console.error("[bookings/checkIn]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── GPS Check-out ────────────────────────────────────────────────────
export const checkOut = async (req, res) => {
  const { lat, lng } = req.body; // optional

  try {
    // In checkOut controller, change the UPDATE to:
    const { rows } = await req.db.query(
      `UPDATE bookings
   SET checkout_at = now(),
       checkout_lat = $3,        -- ← ADD
       checkout_lng = $4,        -- ← ADD
       live_tracking_on = false,
       updated_at = now()
   WHERE id = $1 AND maid_id = $2 AND status = 'in_progress'
   RETURNING *`,
      [req.params.id, req.user.id, lat || null, lng || null],
    );

    if (!rows.length) {
      const { rows: debug } = await req.db.query(
        `SELECT id, status, maid_id FROM bookings WHERE id = $1`,
        [req.params.id],
      );
      console.error("[checkout] booking state:", debug[0]);
      return res.status(404).json({
        error: "Booking not found or not in progress",
      });
    }

    // ✅ Notify only on success — inside the success block
    await notify(req.db, {
      userId: rows[0].customer_id,
      type: "booking_checkout",
      title: "🏁 Maid checked out",
      body: "Your maid has finished. Please mark the job complete and leave a review.",
      data: { booking_id: req.params.id },
      action_url: `/bookings/${req.params.id}`,
    });

    if (lat && lng) {
      try {
        await req.db.query(
          `INSERT INTO booking_locations (booking_id, maid_id, lat, lng, recorded_at)
           VALUES ($1, $2, $3, $4, now())`,
          [req.params.id, req.user.id, lat, lng],
        );
      } catch {}
    }

    return res.json({
      message: "Checked out successfully",
      booking: rows[0],
      checkout: { lat: lat || null, lng: lng || null, at: new Date() },
    });
  } catch (err) {
    console.error("[bookings/checkOut]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── Trigger SOS ──────────────────────────────────────────────────────
export const triggerSOS = async (req, res) => {
  const { lat, lng, address, message } = req.body;

  try {
    const { rows: bookingRows } = await req.db.query(
      `SELECT b.id, b.customer_id, b.maid_id,
              c.name as customer_name, c.email as customer_email,
              m.name as maid_name, m.email as maid_email
       FROM bookings b
       JOIN users c ON c.id = b.customer_id
       JOIN users m ON m.id = b.maid_id
       WHERE b.id = $1
         AND (b.customer_id = $2 OR b.maid_id = $2)
         AND b.status IN ('confirmed','in_progress')`,
      [req.params.id, req.user.id],
    );

    if (!bookingRows.length) {
      return res.status(404).json({ error: "active booking not found" });
    }

    const booking = bookingRows[0];

    const { rows: customerEmergency } = await req.db.query(
      `SELECT name, phone, email, relationship FROM emergency_contacts
       WHERE user_id = $1 ORDER BY is_primary DESC`,
      [booking.customer_id],
    );
    const { rows: maidEmergency } = await req.db.query(
      `SELECT name, phone, email, relationship FROM emergency_contacts
       WHERE user_id = $1 ORDER BY is_primary DESC`,
      [booking.maid_id],
    );

    function ecHtml(contacts, label) {
      if (!contacts.length)
        return `<p><em>No ${label} emergency contacts on file.</em></p>`;
      return contacts
        .map(
          (c) => `
        <tr>
          <td style="padding:6px 12px">${c.name}</td>
          <td style="padding:6px 12px">${c.relationship}</td>
          <td style="padding:6px 12px">${c.phone}</td>
          <td style="padding:6px 12px">${c.email || "—"}</td>
        </tr>`,
        )
        .join("");
    }

    const { rows } = await req.db.query(
      `INSERT INTO sos_alerts (booking_id, triggered_by, lat, lng, address, message)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        booking.id,
        req.user.id,
        lat || null,
        lng || null,
        address || null,
        message || "SOS triggered",
      ],
    );

    const sos = rows[0];

    // ✅ triggeredByName defined BEFORE it's used
    const triggeredByName =
      req.user.id === booking.customer_id
        ? booking.customer_name
        : booking.maid_name;

    // ✅ Notify calls AFTER triggeredByName is defined
    await notifyMany(req.db, [booking.customer_id, booking.maid_id], {
      type: "sos_triggered",
      title: "🚨 SOS Alert Triggered",
      body: `SOS triggered by ${triggeredByName}. Emergency contacts have been notified.`,
      data: { booking_id: req.params.id },
      action_url: `/bookings/${req.params.id}`,
      priority: "urgent",
    });

    await notifyAdmins(req.db, {
      type: "sos_triggered",
      title: "🚨 SOS ALERT",
      body: `SOS triggered by ${triggeredByName} on booking ${req.params.id.slice(0, 8)}. Immediate attention required.`,
      data: { booking_id: req.params.id },
      priority: "urgent",
    });

    const { rows: adminRows } = await req.db.query(
      `SELECT email, name FROM users WHERE role = 'admin' AND is_active = true`,
    );

    const sosEmailHtml = `
      <div style="font-family:sans-serif;max-width:580px;margin:0 auto;padding:32px">
        <div style="background:#dc2626;padding:20px;border-radius:8px;margin-bottom:24px">
          <h2 style="color:#fff;margin:0">🚨 SOS ALERT — DEUSIZI SPARKLE</h2>
        </div>
        <p><strong>Triggered by:</strong> ${triggeredByName}</p>
        <p><strong>Booking ID:</strong> ${booking.id}</p>
        <p><strong>Customer:</strong> ${booking.customer_name}</p>
        <p><strong>Maid:</strong> ${booking.maid_name}</p>
        ${lat && lng ? `<p><strong>Location:</strong> <a href="https://www.google.com/maps?q=${lat},${lng}">View on Google Maps (${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)})</a></p>` : ""}
        ${address ? `<p><strong>Address:</strong> ${address}</p>` : ""}
        ${message ? `<p><strong>Message:</strong> ${message}</p>` : ""}
        <p><strong>Time:</strong> ${new Date().toUTCString()}</p>
        <h3 style="margin-top:24px;color:#dc2626">👤 Customer Emergency Contacts</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <tr style="background:#f5f5f5">
            <th style="padding:6px 12px;text-align:left">Name</th>
            <th style="padding:6px 12px;text-align:left">Relationship</th>
            <th style="padding:6px 12px;text-align:left">Phone</th>
            <th style="padding:6px 12px;text-align:left">Email</th>
          </tr>
          ${ecHtml(customerEmergency, "customer")}
        </table>
        <h3 style="margin-top:24px;color:#dc2626">🧹 Maid Emergency Contacts</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <tr style="background:#f5f5f5">
            <th style="padding:6px 12px;text-align:left">Name</th>
            <th style="padding:6px 12px;text-align:left">Relationship</th>
            <th style="padding:6px 12px;text-align:left">Phone</th>
            <th style="padding:6px 12px;text-align:left">Email</th>
          </tr>
          ${ecHtml(maidEmergency, "maid")}
        </table>
      </div>`;

    const allRecipients = [
      { email: booking.customer_email, name: booking.customer_name },
      { email: booking.maid_email, name: booking.maid_name },
      ...adminRows,
    ];

    for (const recipient of allRecipients) {
      transporter
        .sendMail({
          from: `${process.env.APP_NAME} <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
          to: recipient.email,
          subject: `🚨 SOS ALERT — ${process.env.APP_NAME}`,
          html: sosEmailHtml,
        })
        .catch(console.error);
    }

    return res.status(201).json({
      message: "SOS alert triggered. Admin and all parties have been notified.",
      sos,
    });
  } catch (err) {
    console.error("[bookings/triggerSOS]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── Update live location (maid pings during job) ─────────────────────
export const updateLocation = async (req, res) => {
  const { lat, lng, accuracy } = req.body;
  if (!lat || !lng)
    return res.status(400).json({ error: "lat and lng are required" });

  try {
    // Verify booking is in progress and belongs to this maid
    const { rows: bookingRows } = await req.db.query(
      `SELECT id FROM bookings
       WHERE id = $1 AND maid_id = $2 AND status = 'in_progress' AND live_tracking_on = true`,
      [req.params.id, req.user.id],
    );
    if (!bookingRows.length) {
      return res
        .status(403)
        .json({ error: "not authorized or tracking not active" });
    }

    await req.db.query(
      `INSERT INTO booking_locations (booking_id, maid_id, lat, lng, accuracy)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, req.user.id, lat, lng, accuracy || null],
    );

    // Prune old pings — keep only last 100 per booking
    await req.db.query(
      `DELETE FROM booking_locations
       WHERE booking_id = $1
         AND id NOT IN (
           SELECT id FROM booking_locations
           WHERE booking_id = $1
           ORDER BY recorded_at DESC
           LIMIT 100
         )`,
      [req.params.id],
    );

    return res.json({ success: true, recorded_at: new Date() });
  } catch (err) {
    console.error("[bookings/updateLocation]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── Get live location (customer + admin) ────────────────────────────
export const getJobLocation = async (req, res) => {
  try {
    const { rows: bookingRows } = await req.db.query(
      `SELECT customer_id, maid_id, status, live_tracking_on
       FROM bookings WHERE id = $1`,
      [req.params.id],
    );
    if (!bookingRows.length)
      return res.status(404).json({ error: "booking not found" });

    const booking = bookingRows[0];
    const isParticipant =
      booking.customer_id === req.user.id || booking.maid_id === req.user.id;
    if (!isParticipant && req.user.role !== "admin") {
      return res.status(403).json({ error: "forbidden" });
    }

    if (!booking.live_tracking_on) {
      return res.json({ tracking: false, location: null });
    }

    const { rows: locRows } = await req.db.query(
      `SELECT lat, lng, accuracy, recorded_at
       FROM booking_locations
       WHERE booking_id = $1
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [req.params.id],
    );

    return res.json({
      tracking: true,
      location: locRows[0] || null,
    });
  } catch (err) {
    console.error("[bookings/getJobLocation]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
// ─── Resolve SOS (admin only) ─────────────────────────────────────────
export const resolveSOSAlert = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `UPDATE sos_alerts
       SET status = 'resolved', resolved_by = $1, resolved_at = now()
       WHERE id = $2 AND status = 'active'
       RETURNING *`,
      [req.user.id, req.params.alertId],
    );
    if (!rows.length)
      return res
        .status(404)
        .json({ error: "alert not found or already resolved" });
    return res.json({ alert: rows[0] });
  } catch (err) {
    console.error("[bookings/resolveSOSAlert]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── Get SOS alerts (admin) ───────────────────────────────────────────
export const getSOSAlerts = async (req, res) => {
  const { status = "active", page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  try {
    const { rows } = await req.db.query(
      `SELECT sa.*,
              u.name as triggered_by_name, u.role as triggered_by_role,
              b.service_date, b.address as booking_address,
              c.name as customer_name, c.phone as customer_phone,
              m.name as maid_name, m.phone as maid_phone
       FROM sos_alerts sa
       JOIN users u ON u.id = sa.triggered_by
       JOIN bookings b ON b.id = sa.booking_id
       JOIN users c ON c.id = b.customer_id
       JOIN users m ON m.id = b.maid_id
       WHERE sa.status = $1
       ORDER BY sa.created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, Number(limit), offset],
    );
    return res.json({ alerts: rows });
  } catch (err) {
    console.error("[bookings/getSOSAlerts]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── Initiate video call ──────────────────────────────────────────────
// Uses a simple token — frontend uses Daily.co / Agora with this room name
export const initiateVideoCall = async (req, res) => {
  try {
    const { rows: bookingRows } = await req.db.query(
      `SELECT * FROM bookings
       WHERE id = $1
         AND (customer_id = $2 OR maid_id = $2)
         AND status IN ('confirmed', 'in_progress')`,
      [req.params.id, req.user.id],
    );

    if (!bookingRows.length) {
      return res.status(404).json({ error: "confirmed booking not found" });
    }

    const booking = bookingRows[0];
    const roomName =
      booking.video_call_room ||
      `ds-${booking.id.slice(0, 8)}-${crypto.randomBytes(4).toString("hex")}`;
    const callUrl = `https://meet.jit.si/${roomName}`;

    await req.db.query(
      `UPDATE bookings
       SET video_call_room = $1, video_call_status = 'ringing', video_call_started_at = now()
       WHERE id = $2`,
      [roomName, booking.id],
    );

    // Notify the OTHER party (customer if maid calls, maid if customer calls)
    const recipientId =
      req.user.id === booking.maid_id ? booking.customer_id : booking.maid_id;

    await notify(req.db, {
      userId: recipientId,
      type: "video_call_incoming",
      title: "📹 Incoming Video Call",
      body: "You have an incoming video call. Tap to answer.",
      data: { booking_id: booking.id, call_url: callUrl },
      action_url: `/bookings/${booking.id}`,
    });

    return res.json({ call_url: callUrl, room: roomName, status: "ringing" });
  } catch (err) {
    console.error("[bookings/initiateVideoCall]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── Get active call status for a booking ─────────────────────────────
export const getVideoCallStatus = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT video_call_room, video_call_status, video_call_started_at
       FROM bookings
       WHERE id = $1 AND (customer_id = $2 OR maid_id = $2)`,
      [req.params.id, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: "not found" });

    const b = rows[0];
    const callUrl = b.video_call_room
      ? `https://meet.jit.si/${b.video_call_room}`
      : null;

    return res.json({
      status: b.video_call_status || "idle",
      call_url: callUrl,
      started_at: b.video_call_started_at,
    });
  } catch (err) {
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── End / decline a video call ───────────────────────────────────────
export const endVideoCall = async (req, res) => {
  try {
    await req.db.query(
      `UPDATE bookings
       SET video_call_status = 'ended', video_call_room = NULL
       WHERE id = $1 AND (customer_id = $2 OR maid_id = $2)`,
      [req.params.id, req.user.id],
    );
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── Check for any incoming call across all user's bookings ───────────
export const getActiveCallForUser = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT b.id AS booking_id, b.video_call_room, b.video_call_started_at,
              c.name AS customer_name, m.name AS maid_name,
              c.avatar AS customer_avatar, m.avatar AS maid_avatar
       FROM bookings b
       JOIN users c ON c.id = b.customer_id
       JOIN users m ON m.id = b.maid_id
       WHERE (b.customer_id = $1 OR b.maid_id = $1)
         AND b.video_call_status = 'ringing'
         AND b.video_call_started_at > now() - interval '90 seconds'
       ORDER BY b.video_call_started_at DESC
       LIMIT 1`,
      [req.user.id],
    );

    if (!rows.length) return res.json({ call: null });

    const row = rows[0];
    return res.json({
      call: {
        booking_id: row.booking_id,
        call_url: `https://meet.jit.si/${row.video_call_room}`,
        caller_name:
          req.user.id === row.customer_id ? row.maid_name : row.customer_name,
        caller_avatar:
          req.user.id === row.customer_id
            ? row.maid_avatar
            : row.customer_avatar,
        started_at: row.video_call_started_at,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── Emergency contacts ───────────────────────────────────────────────
export const setEmergencyContact = async (req, res) => {
  const {
    name,
    phone,
    phone_country_code = "+234",
    email,
    relationship = "other",
    is_primary = false,
  } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: "name and phone are required" });
  }
  const fullPhone = phone.startsWith("+")
    ? phone
    : `${phone_country_code}${phone.replace(/^0/, "")}`;

  try {
    // If setting as primary, unset existing primary first
    if (is_primary) {
      await req.db.query(
        `UPDATE emergency_contacts SET is_primary = false WHERE user_id = $1`,
        [req.user.id],
      );
    }

    const { rows } = await req.db.query(
      `INSERT INTO emergency_contacts (user_id, name, phone, email, relationship, is_primary)
   VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, name, fullPhone, email || null, relationship, is_primary],
    );

    return res.status(201).json({ contact: rows[0] });
  } catch (err) {
    console.error("[bookings/setEmergencyContact]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const getEmergencyContacts = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT * FROM emergency_contacts
       WHERE user_id = $1
       ORDER BY is_primary DESC, created_at ASC`,
      [req.user.id],
    );
    return res.json({ contacts: rows });
  } catch (err) {
    console.error("[bookings/getEmergencyContacts]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const deleteEmergencyContact = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `DELETE FROM emergency_contacts WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.contactId, req.user.id],
    );
    if (!rows.length)
      return res.status(404).json({ error: "contact not found" });
    return res.json({ message: "contact deleted" });
  } catch (err) {
    console.error("[bookings/deleteEmergencyContact]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ─── Submit review (unchanged logic, kept here) ───────────────────────
export const submitReview = async (req, res) => {
  const { rating, comment } = req.body;
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "rating must be between 1 and 5" });
  }

  try {
    const { rows: bookingRows } = await req.db.query(
      `SELECT * FROM bookings WHERE id = $1 AND customer_id = $2 AND status = 'completed'`,
      [req.params.id, req.user.id],
    );
    if (!bookingRows.length)
      return res.status(404).json({ error: "completed booking not found" });

    const booking = bookingRows[0];
    const { rows } = await req.db.query(
      `INSERT INTO reviews (booking_id, customer_id, maid_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (booking_id) DO NOTHING RETURNING *`,
      [booking.id, req.user.id, booking.maid_id, rating, comment || null],
    );

    if (!rows.length)
      return res.status(409).json({ error: "review already submitted" });

    await req.db.query(
      `UPDATE maid_profiles SET
         rating = (SELECT AVG(rating) FROM reviews WHERE maid_id = $1),
         total_reviews = (SELECT COUNT(*) FROM reviews WHERE maid_id = $1)
       WHERE user_id = $1`,
      [booking.maid_id],
    );

    await notify(req.db, {
      userId: booking.maid_id,
      type: "review_received",
      title: "⭐ New Review",
      body: `You received a ${rating}-star review from ${req.user.name || "a customer"}.`,
      data: { booking_id: req.params.id, rating },
      action_url: `/bookings/${req.params.id}`,
    });

    return res.status(201).json({ review: rows[0] });
  } catch (err) {
    console.error("[bookings/submitReview]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Update booking status ─────────────────────────────────────────────
export const updateBookingStatus = async (req, res) => {
  const { id } = req.params;
  const { status, declined_reason, declined_by } = req.body;

  // ── Valid transitions per role ────────────────────────────────────
  const MAID_ALLOWED = ["confirmed", "declined", "in_progress", "completed"];
  const CUSTOMER_ALLOWED = ["cancelled"];
  const ADMIN_ALLOWED = [
    "confirmed",
    "declined",
    "in_progress",
    "completed",
    "cancelled",
  ];

  const allowedStatuses =
    req.user.role === "maid"
      ? MAID_ALLOWED
      : req.user.role === "customer"
        ? CUSTOMER_ALLOWED
        : ADMIN_ALLOWED;

  if (!status || !allowedStatuses.includes(status)) {
    return res.status(400).json({
      error: `status must be one of: ${allowedStatuses.join(", ")}`,
    });
  }

  try {
    // ── Fetch booking to verify ownership + current state ─────────
    const { rows: existing } = await req.db.query(
      `SELECT b.*,
              c.name AS customer_name, c.email AS customer_email,
              m.name AS maid_name,     m.email AS maid_email
       FROM bookings b
       JOIN users c ON c.id = b.customer_id
       JOIN users m ON m.id = b.maid_id
       WHERE b.id = $1`,
      [id],
    );

    if (!existing.length) {
      return res.status(404).json({ error: "booking not found" });
    }

    const booking = existing[0];

    // ── Ownership check ───────────────────────────────────────────
    if (req.user.role === "maid" && booking.maid_id !== req.user.id) {
      return res.status(403).json({ error: "not your booking" });
    }
    if (req.user.role === "customer" && booking.customer_id !== req.user.id) {
      return res.status(403).json({ error: "not your booking" });
    }

    // ── Guard illegal transitions ─────────────────────────────────
    const TERMINAL = ["completed", "cancelled", "declined"];
    if (TERMINAL.includes(booking.status)) {
      return res.status(409).json({
        error: `booking is already ${booking.status} and cannot be changed`,
      });
    }

    // Customers can only cancel pending / confirmed bookings
    if (
      req.user.role === "customer" &&
      !["pending", "confirmed", "awaiting_payment"].includes(booking.status)
    ) {
      return res.status(409).json({
        error: "you can only cancel a booking that has not started",
      });
    }

    // ── Build dynamic UPDATE ──────────────────────────────────────
    const fields = ["status = $2", "updated_at = now()"];
    const params = [id, status];

    if (status === "declined" && declined_reason) {
      params.push(declined_reason);
      fields.push(`notes = $${params.length}`); // store reason in notes
    }

    const { rows } = await req.db.query(
      `UPDATE bookings
       SET ${fields.join(", ")}
       WHERE id = $1
       RETURNING *`,
      params,
    );

    if (!rows.length) {
      return res.status(404).json({ error: "booking not found" });
    }

    const updated = rows[0];

    // Notify the OTHER party about status changes
    if (status === "confirmed") {
      await notify(req.db, {
        userId: booking.customer_id,
        type: "booking_confirmed",
        title: "✅ Booking Confirmed",
        body: `${booking.maid_name} accepted your booking.`,
        data: { booking_id: id },
        action_url: `/bookings/${id}`,
        priority: "high",
      });
    }
    if (status === "declined") {
      await notify(req.db, {
        userId: booking.customer_id,
        type: "booking_cancelled",
        title: "❌ Booking Declined",
        body: `${booking.maid_name} declined your booking.`,
        data: { booking_id: id },
        action_url: `/bookings/${id}`,
      });
    }
    if (status === "cancelled") {
      // Notify whoever DIDN'T cancel
      const otherUserId =
        req.user.role === "customer" ? booking.maid_id : booking.customer_id;
      const cancellerName =
        req.user.role === "customer"
          ? booking.customer_name
          : booking.maid_name;
      await notify(req.db, {
        userId: otherUserId,
        type: "booking_cancelled",
        title: "🚫 Booking Cancelled",
        body: `${cancellerName} cancelled the booking.`,
        data: { booking_id: id },
        action_url: `/bookings/${id}`,
      });
    }
    if (status === "completed") {
      await notify(req.db, {
        userId: booking.customer_id,
        type: "booking_completed",
        title: "🎉 Job Completed",
        body: `Your booking with ${booking.maid_name} is complete. Leave a review!`,
        data: { booking_id: id },
        action_url: `/bookings/${id}`,
      });
      // Also notify maid
      await notify(req.db, {
        userId: booking.maid_id,
        type: "booking_completed",
        title: "🎉 Job Marked Complete",
        body: `Booking with ${booking.customer_name} is complete. Payment is being processed.`,
        data: { booking_id: id },
        action_url: `/bookings/${id}`,
      });
    }

    return res.json({
      booking: updated,
      message: `Booking ${status}`,
    });
  } catch (err) {
    console.error("[bookings/updateBookingStatus]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
