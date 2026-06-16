// src/models/FoundationDonation.js
import pool from "../config/database.js";

class FoundationDonation {
  static async create(donationData) {
    const {
      donorName,
      donorEmail,
      donorMessage,
      amount,
      donationType,
      paymentReference,
      paymentMethod,
      transactionId,
    } = donationData;

    const query = `
      INSERT INTO foundation_donations (
        donor_name, donor_email, donor_message, amount, donation_type,
        payment_reference, payment_method, transaction_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const values = [
      donorName,
      donorEmail,
      donorMessage || null,
      amount,
      donationType || "once",
      paymentReference || null,
      paymentMethod || null,
      transactionId || null,
    ];

    try {
      const { rows } = await pool.query(query, values);
      return rows[0];
    } catch (error) {
      console.error("Error creating foundation donation:", error);
      throw error;
    }
  }

  static async findAll(filters = {}) {
    const { status, donationType, page = 1, limit = 50 } = filters;
    const offset = (Number(page) - 1) * Number(limit);

    let query = `
      SELECT 
        id, donor_name, donor_email, donor_message, amount, donation_type,
        status, payment_reference, payment_method, transaction_id,
        admin_notes, completed_at, created_at, updated_at
      FROM foundation_donations
      WHERE 1=1
    `;

    const conditions = [];
    const params = [];
    let paramCount = 1;

    if (status) {
      conditions.push(`status = $${paramCount++}`);
      params.push(status);
    }

    if (donationType) {
      conditions.push(`donation_type = $${paramCount++}`);
      params.push(donationType);
    }

    if (conditions.length) {
      query += ` AND ${conditions.join(" AND ")}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(limit, offset);

    // Count query for pagination
    let countQuery = `
      SELECT COUNT(*) FROM foundation_donations WHERE 1=1
    `;
    if (conditions.length) {
      countQuery += ` AND ${conditions.join(" AND ")}`;
    }

    try {
      const { rows } = await pool.query(query, params);
      const { rows: countRows } = await pool.query(
        countQuery,
        params.slice(0, -2),
      );

      return {
        donations: rows,
        total: parseInt(countRows[0].count),
        page: Number(page),
        limit: Number(limit),
      };
    } catch (error) {
      console.error("Error fetching foundation donations:", error);
      throw error;
    }
  }

  static async findById(id) {
    const query = `
      SELECT 
        id, donor_name, donor_email, donor_message, amount, donation_type,
        status, payment_reference, payment_method, transaction_id,
        admin_notes, completed_at, created_at, updated_at
      FROM foundation_donations
      WHERE id = $1
    `;

    try {
      const { rows } = await pool.query(query, [id]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error finding foundation donation by ID:", error);
      throw error;
    }
  }

  static async findByEmail(email) {
    const query = `
      SELECT * FROM foundation_donations WHERE donor_email = $1
      ORDER BY created_at DESC
    `;

    try {
      const { rows } = await pool.query(query, [email]);
      return rows;
    } catch (error) {
      console.error("Error finding foundation donations by email:", error);
      throw error;
    }
  }

  static async updateStatus(id, status, adminNotes = null, completedAt = null) {
    const query = `
      UPDATE foundation_donations 
      SET status = $1,
          admin_notes = COALESCE($2, admin_notes),
          completed_at = COALESCE($3, completed_at),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `;

    try {
      const { rows } = await pool.query(query, [
        status,
        adminNotes,
        completedAt,
        id,
      ]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error updating foundation donation status:", error);
      throw error;
    }
  }

  static async updateAdminNotes(id, notes) {
    const query = `
      UPDATE foundation_donations 
      SET admin_notes = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;

    try {
      const { rows } = await pool.query(query, [notes, id]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error updating admin notes:", error);
      throw error;
    }
  }

  static async delete(id) {
    const query = `DELETE FROM foundation_donations WHERE id = $1 RETURNING *`;

    try {
      const { rows } = await pool.query(query, [id]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error deleting foundation donation:", error);
      throw error;
    }
  }

  static async getStats() {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COUNT(CASE WHEN status = 'refunded' THEN 1 END) as refunded,
        COUNT(CASE WHEN donation_type = 'monthly' THEN 1 END) as monthly_donors,
        SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_raised,
        AVG(CASE WHEN status = 'completed' THEN amount ELSE NULL END) as avg_donation
      FROM foundation_donations
    `;

    try {
      const { rows } = await pool.query(query);
      return rows[0];
    } catch (error) {
      console.error("Error getting foundation donation stats:", error);
      throw error;
    }
  }

  static async getMonthlyStats() {
    const query = `
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as count,
        SUM(amount) as total
      FROM foundation_donations
      WHERE status = 'completed'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month DESC
      LIMIT 12
    `;

    try {
      const { rows } = await pool.query(query);
      return rows;
    } catch (error) {
      console.error("Error getting monthly stats:", error);
      throw error;
    }
  }
}

export default FoundationDonation;
