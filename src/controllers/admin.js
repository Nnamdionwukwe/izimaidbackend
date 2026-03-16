import jwt from "jsonwebtoken";
import { safeGet, safeSet, safeDel } from "../config/redis.js";

const JWT_SECRET = process.env.JWT_SECRET;

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
      `SELECT id, email, name, avatar, role, is_active, created_at, google_id
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
      `UPDATE users SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows.length) return res.status(404).json({ error: "user not found" });

    // Clear user cache
    await safeDel(`user:${req.params.id}`);

    return res.json({ user: rows[0] });
  } catch (err) {
    console.error("[admin.controller/updateUser]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const deleteUser = async (req, res) => {
  const userId = req.params.id;

  // Prevent admin from deleting themselves
  if (Number(userId) === Number(req.user.id)) {
    return res
      .status(400)
      .json({ error: "You cannot delete your own account" });
  }

  try {
    // Start transaction
    const client = await req.db.connect();

    try {
      await client.query("BEGIN");

      // Check if user exists
      const { rows: userRows } = await client.query(
        "SELECT id, role FROM users WHERE id = $1",
        [userId],
      );

      if (!userRows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "user not found" });
      }

      const user = userRows[0];

      // Delete related data based on user role
      if (user.role === "maid") {
        // Delete maid profile
        await client.query("DELETE FROM maid_profiles WHERE user_id = $1", [
          userId,
        ]);

        // Delete or reassign maid's bookings
        // Option 1: Delete bookings (uncomment if preferred)
        // await client.query("DELETE FROM bookings WHERE maid_id = $1", [userId]);

        // Option 2: Mark bookings as cancelled (recommended)
        await client.query(
          "UPDATE bookings SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE maid_id = $1 AND status NOT IN ('completed', 'cancelled')",
          [userId],
        );

        // Delete maid's reviews
        await client.query("DELETE FROM reviews WHERE maid_id = $1", [userId]);
      }

      if (user.role === "customer") {
        // Delete or reassign customer's bookings
        // Option 1: Delete bookings (uncomment if preferred)
        // await client.query("DELETE FROM bookings WHERE customer_id = $1", [userId]);

        // Option 2: Mark bookings as cancelled (recommended)
        await client.query(
          "UPDATE bookings SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE customer_id = $1 AND status NOT IN ('completed', 'cancelled')",
          [userId],
        );
      }

      // Delete user payments
      await client.query(
        "DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE customer_id = $1 OR maid_id = $1)",
        [userId],
      );

      // Delete user
      await client.query("DELETE FROM users WHERE id = $1", [userId]);

      // Commit transaction
      await client.query("COMMIT");

      // Clear user cache
      await safeDel(`user:${userId}`);

      return res.json({ message: "user deleted successfully" });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[admin.controller/deleteUser]", err);
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
