// src/controllers/earnings.controller.js

export const getEarnings = async (req, res) => {
  const {
    status = "completed",
    period = "all",
    currency,
    page = 1,
    limit = 20,
  } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const conditions = ["b.maid_id = $1"];
  const params = [req.user.id];

  if (status !== "all") {
    params.push(status);
    conditions.push(`b.status = $${params.length}`);
  }

  // Filter by currency if requested
  if (currency) {
    params.push(currency.toUpperCase());
    conditions.push(
      `COALESCE(p.currency, mp.currency, 'NGN') = $${params.length}`,
    );
  }

  const periodClause =
    {
      this_week: `AND b.service_date >= date_trunc('week',  now())`,
      this_month: `AND b.service_date >= date_trunc('month', now())`,
      this_year: `AND b.service_date >= date_trunc('year',  now())`,
      all: "",
    }[period] || "";

  // Base JOIN needed for currency detection
  const baseJoin = `
    FROM bookings b
    JOIN users u ON u.id = b.customer_id
    LEFT JOIN payments p ON p.booking_id = b.id AND p.status = 'success'
    LEFT JOIN maid_profiles mp ON mp.user_id = b.maid_id
  `;

  const where = `WHERE ${conditions.join(" AND ")} ${periodClause}`;

  try {
    // ── Paginated bookings ──────────────────────────────────────────
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
         u.avatar AS customer_avatar,
         COALESCE(p.currency, mp.currency, 'NGN') AS currency
       ${baseJoin}
       ${where}
       ORDER BY b.service_date DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, Number(limit), offset],
    );

    // ── Summary per currency ────────────────────────────────────────
    const { rows: summaryRows } = await req.db.query(
      `SELECT
         COALESCE(p.currency, mp.currency, 'NGN')  AS currency,
         COUNT(*)                                   AS booking_count,
         COALESCE(SUM(b.total_amount),   0)         AS total_earned,
         COALESCE(AVG(b.total_amount),   0)         AS avg_per_booking,
         COALESCE(SUM(b.duration_hours), 0)         AS total_hours,
         COALESCE(MAX(b.total_amount),   0)         AS highest_booking,
         COALESCE(MIN(b.total_amount),   0)         AS lowest_booking
       FROM bookings b
       LEFT JOIN payments p ON p.booking_id = b.id AND p.status = 'success'
       LEFT JOIN maid_profiles mp ON mp.user_id = b.maid_id
       WHERE b.maid_id = $1
         AND b.status  = 'completed'
         ${periodClause}
       GROUP BY COALESCE(p.currency, mp.currency, 'NGN')
       ORDER BY total_earned DESC`,
      [req.user.id],
    );

    // ── Monthly chart per currency (last 6 months) ─────────────────
    const { rows: monthly } = await req.db.query(
      `SELECT
         to_char(date_trunc('month', b.service_date), 'Mon YY') AS month,
         COALESCE(p.currency, mp.currency, 'NGN')               AS currency,
         COUNT(*)                                                AS bookings,
         COALESCE(SUM(b.total_amount), 0)                       AS earned
       FROM bookings b
       LEFT JOIN payments p ON p.booking_id = b.id AND p.status = 'success'
       LEFT JOIN maid_profiles mp ON mp.user_id = b.maid_id
       WHERE b.maid_id = $1
         AND b.status  = 'completed'
         AND b.service_date >= now() - interval '6 months'
         ${periodClause}
       GROUP BY date_trunc('month', b.service_date),
                COALESCE(p.currency, mp.currency, 'NGN')
       ORDER BY date_trunc('month', b.service_date) ASC`,
      [req.user.id],
    );

    // ── Total count for pagination ──────────────────────────────────
    const { rows: countRows } = await req.db.query(
      `SELECT COUNT(*)
       ${baseJoin}
       ${where}`,
      params,
    );

    // ── All currencies this maid has earned in ──────────────────────
    const currencies = summaryRows.map((s) => s.currency);

    return res.json({
      bookings,
      summary: summaryRows,
      monthly,
      currencies,
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
    const { rows } = await req.db.query(
      `SELECT
         COALESCE(p.currency, mp.currency, 'NGN')          AS currency,
         COUNT(*)                                           AS total_bookings,
         COALESCE(SUM(b.total_amount),   0)                AS total_earned,
         COALESCE(AVG(b.total_amount),   0)                AS avg_per_booking,
         COALESCE(SUM(b.duration_hours), 0)                AS total_hours,
         COUNT(*) FILTER (
           WHERE b.service_date >= date_trunc('month', now())) AS this_month_bookings,
         COALESCE(SUM(b.total_amount) FILTER (
           WHERE b.service_date >= date_trunc('month', now())), 0) AS this_month_earned,
         COUNT(*) FILTER (
           WHERE b.service_date >= date_trunc('week', now()))  AS this_week_bookings,
         COALESCE(SUM(b.total_amount) FILTER (
           WHERE b.service_date >= date_trunc('week', now())), 0) AS this_week_earned
       FROM bookings b
       LEFT JOIN payments p ON p.booking_id = b.id AND p.status = 'success'
       LEFT JOIN maid_profiles mp ON mp.user_id = b.maid_id
       WHERE b.maid_id = $1 AND b.status = 'completed'
       GROUP BY COALESCE(p.currency, mp.currency, 'NGN')
       ORDER BY total_earned DESC`,
      [req.user.id],
    );

    return res.json({ stats: rows });
  } catch (err) {
    console.error("[earnings/getEarningsStats]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
