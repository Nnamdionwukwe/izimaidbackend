// src/controllers/earnings.controller.js

export const getEarnings = async (req, res) => {
  const {
    status = "completed",
    period = "all",
    page = 1,
    limit = 20,
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  // Currency lives on maid_profiles, not bookings
  const { rows: maidRows } = await req.db.query(
    `SELECT currency FROM maid_profiles WHERE user_id = $1`,
    [req.user.id],
  );
  const maidCurrency = maidRows[0]?.currency || "NGN";

  const conditions = ["b.maid_id = $1"];
  const params = [req.user.id];

  if (status !== "all") {
    params.push(status);
    conditions.push(`b.status = $${params.length}`);
  }

  const periodClause =
    {
      this_week: `AND b.service_date >= date_trunc('week',  now())`,
      this_month: `AND b.service_date >= date_trunc('month', now())`,
      this_year: `AND b.service_date >= date_trunc('year',  now())`,
      all: "",
    }[period] || "";

  const where = `WHERE ${conditions.join(" AND ")} ${periodClause}`;

  try {
    // ── Paginated bookings ─────────────────────────────────────────
    const { rows: bookings } = await req.db.query(
      `SELECT
         b.id,
         b.service_date,
         b.status,
         b.duration_hours,
         b.total_amount,
         b.address,
         b.notes,
         u.name   AS customer_name,
         u.avatar AS customer_avatar
       FROM bookings b
       JOIN users u ON u.id = b.customer_id
       ${where}
       ORDER BY b.service_date DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, Number(limit), offset],
    );

    // ── Summary stats ──────────────────────────────────────────────
    const { rows: s } = await req.db.query(
      `SELECT
         COUNT(*)                           AS booking_count,
         COALESCE(SUM(b.total_amount),   0) AS total_earned,
         COALESCE(AVG(b.total_amount),   0) AS avg_per_booking,
         COALESCE(SUM(b.duration_hours), 0) AS total_hours,
         COALESCE(MAX(b.total_amount),   0) AS highest_booking,
         COALESCE(MIN(b.total_amount),   0) AS lowest_booking
       FROM bookings b
       WHERE b.maid_id = $1
         AND b.status  = 'completed'
         ${periodClause}`,
      [req.user.id],
    );

    // ── Total count for pagination ─────────────────────────────────
    const { rows: countRows } = await req.db.query(
      `SELECT COUNT(*) FROM bookings b ${where}`,
      params,
    );

    // ── Monthly chart — last 6 months ──────────────────────────────
    const { rows: monthly } = await req.db.query(
      `SELECT
         to_char(date_trunc('month', b.service_date), 'Mon YY') AS month,
         COUNT(*)                          AS bookings,
         COALESCE(SUM(b.total_amount), 0)  AS earned
       FROM bookings b
       WHERE b.maid_id = $1
         AND b.status  = 'completed'
         AND b.service_date >= now() - interval '6 months'
         ${periodClause}
       GROUP BY date_trunc('month', b.service_date)
       ORDER BY date_trunc('month', b.service_date) ASC`,
      [req.user.id],
    );

    return res.json({
      bookings,
      summary: [{ ...s[0], currency: maidCurrency }],
      monthly: monthly.map((m) => ({ ...m, currency: maidCurrency })),
      currencies: [maidCurrency],
      total: Number(countRows[0]?.count || 0),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    console.error("[earnings/getEarnings]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const getEarningsStats = async (req, res) => {
  try {
    const { rows: maidRows } = await req.db.query(
      `SELECT currency FROM maid_profiles WHERE user_id = $1`,
      [req.user.id],
    );
    const c = maidRows[0]?.currency || "NGN";

    const { rows } = await req.db.query(
      `SELECT
         COUNT(*)                          AS total_bookings,
         COALESCE(SUM(total_amount),   0)  AS total_earned,
         COALESCE(AVG(total_amount),   0)  AS avg_per_booking,
         COALESCE(SUM(duration_hours), 0)  AS total_hours,
         COUNT(*) FILTER (
           WHERE service_date >= date_trunc('month', now()))             AS this_month_bookings,
         COALESCE(SUM(total_amount) FILTER (
           WHERE service_date >= date_trunc('month', now())), 0)         AS this_month_earned,
         COUNT(*) FILTER (
           WHERE service_date >= date_trunc('week', now()))              AS this_week_bookings,
         COALESCE(SUM(total_amount) FILTER (
           WHERE service_date >= date_trunc('week', now())), 0)          AS this_week_earned
       FROM bookings
       WHERE maid_id = $1 AND status = 'completed'`,
      [req.user.id],
    );

    return res.json({ stats: [{ ...rows[0], currency: c }] });
  } catch (err) {
    console.error("[earnings/getEarningsStats]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
