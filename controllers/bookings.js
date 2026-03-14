export const createBooking = async (req, res) => {
  const { maid_id, service_date, duration_hours, address, notes } = req.body;

  if (!maid_id || !service_date || !duration_hours || !address) {
    return res
      .status(400)
      .json({
        error: "maid_id, service_date, duration_hours, address are required",
      });
  }

  try {
    const { rows: maidRows } = await req.db.query(
      `SELECT mp.hourly_rate, mp.is_available, u.is_active
       FROM maid_profiles mp
       JOIN users u ON u.id = mp.user_id
       WHERE mp.user_id = $1`,
      [maid_id],
    );

    if (!maidRows.length)
      return res.status(404).json({ error: "maid not found" });

    const maid = maidRows[0];
    if (!maid.is_available || !maid.is_active) {
      return res.status(409).json({ error: "maid is not available" });
    }

    const total_amount = Number(maid.hourly_rate) * Number(duration_hours);

    const { rows } = await req.db.query(
      `INSERT INTO bookings (customer_id, maid_id, service_date, duration_hours, address, notes, total_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        req.user.id,
        maid_id,
        service_date,
        duration_hours,
        address,
        notes || null,
        total_amount,
      ],
    );

    return res.status(201).json({ booking: rows[0] });
  } catch (err) {
    console.error("[bookings.controller/createBooking]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

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
  }
  if (status) {
    params.push(status);
    conditions.push(`b.status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT b.*,
              c.name as customer_name, c.avatar as customer_avatar,
              m.name as maid_name, m.avatar as maid_avatar
       FROM bookings b
       JOIN users c ON c.id = b.customer_id
       JOIN users m ON m.id = b.maid_id
       ${where}
       ORDER BY b.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return res.json({ bookings: rows });
  } catch (err) {
    console.error("[bookings.controller/listBookings]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const getBooking = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT b.*,
              c.name as customer_name, c.avatar as customer_avatar,
              m.name as maid_name, m.avatar as maid_avatar,
              p.status as payment_status, p.paystack_reference
       FROM bookings b
       JOIN users c ON c.id = b.customer_id
       JOIN users m ON m.id = b.maid_id
       LEFT JOIN payments p ON p.booking_id = b.id
       WHERE b.id = $1`,
      [req.params.id],
    );

    if (!rows.length)
      return res.status(404).json({ error: "booking not found" });

    const booking = rows[0];
    const isOwner =
      booking.customer_id === req.user.id || booking.maid_id === req.user.id;

    if (!isOwner && req.user.role !== "admin") {
      return res.status(403).json({ error: "forbidden" });
    }

    return res.json({ booking });
  } catch (err) {
    console.error("[bookings.controller/getBooking]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const updateStatus = async (req, res) => {
  const { status } = req.body;

  const validTransitions = {
    customer: ["cancelled"],
    maid: ["confirmed", "in_progress", "completed"],
    admin: ["pending", "confirmed", "in_progress", "completed", "cancelled"],
  };

  if (!validTransitions[req.user.role]?.includes(status)) {
    return res
      .status(400)
      .json({ error: `invalid status transition for role ${req.user.role}` });
  }

  try {
    const { rows } = await req.db.query(
      `UPDATE bookings SET status = $1
       WHERE id = $2 AND (customer_id = $3 OR maid_id = $3 OR $4 = 'admin')
       RETURNING *`,
      [status, req.params.id, req.user.id, req.user.role],
    );

    if (!rows.length)
      return res
        .status(404)
        .json({ error: "booking not found or not authorized" });
    return res.json({ booking: rows[0] });
  } catch (err) {
    console.error("[bookings.controller/updateStatus]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

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
       ON CONFLICT (booking_id) DO NOTHING
       RETURNING *`,
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

    return res.status(201).json({ review: rows[0] });
  } catch (err) {
    console.error("[bookings.controller/submitReview]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
