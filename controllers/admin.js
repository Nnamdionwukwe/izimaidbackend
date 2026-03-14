export const listUsers = async (req, res) => {
  const { role, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const params = [];
  const conditions = [];

  if (role) {
    params.push(role);
    conditions.push(`role = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT id, email, name, avatar, role, is_active, created_at
       FROM users ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return res.json({ users: rows });
  } catch (err) {
    console.error("[admin.controller/listUsers]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const updateUser = async (req, res) => {
  const { is_active, role } = req.body;
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

  if (!fields.length)
    return res.status(400).json({ error: "no fields to update" });

  params.push(req.params.id);

  try {
    const { rows } = await req.db.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows.length) return res.status(404).json({ error: "user not found" });

    await req.redis.del(`user:${req.params.id}`);
    return res.json({ user: rows[0] });
  } catch (err) {
    console.error("[admin.controller/updateUser]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const listBookings = async (req, res) => {
  const { status, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const params = [];
  const conditions = [];

  if (status) {
    params.push(status);
    conditions.push(`b.status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT b.*, c.name as customer_name, m.name as maid_name,
              p.status as payment_status, p.amount as payment_amount
       FROM bookings b
       JOIN users c ON c.id = b.customer_id
       JOIN users m ON m.id = b.maid_id
       LEFT JOIN payments p ON p.booking_id = b.id
       ${where}
       ORDER BY b.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return res.json({ bookings: rows });
  } catch (err) {
    console.error("[admin.controller/listBookings]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const getStats = async (req, res) => {
  try {
    const [users, bookings, revenue] = await Promise.all([
      req.db.query(`SELECT role, COUNT(*) FROM users GROUP BY role`),
      req.db.query(`SELECT status, COUNT(*) FROM bookings GROUP BY status`),
      req.db.query(
        `SELECT SUM(amount) as total FROM payments WHERE status = 'success'`,
      ),
    ]);

    return res.json({
      users: Object.fromEntries(
        users.rows.map((r) => [r.role, Number(r.count)]),
      ),
      bookings: Object.fromEntries(
        bookings.rows.map((r) => [r.status, Number(r.count)]),
      ),
      total_revenue: Number(revenue.rows[0].total || 0),
    });
  } catch (err) {
    console.error("[admin.controller/getStats]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
