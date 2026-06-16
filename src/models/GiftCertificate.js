// src/models/GiftCertificate.js
import pool from "../config/database.js";
import crypto from "crypto";

class GiftCertificate {
  static generateCode() {
    // Generate a unique code like DSPK-XXXX-XXXX
    const parts = [];
    for (let i = 0; i < 2; i++) {
      parts.push(crypto.randomBytes(2).toString("hex").toUpperCase());
    }
    return `DSPK-${parts.join("-")}`;
  }

  static async create(certificateData) {
    const {
      fromName,
      recipientName,
      recipientEmail,
      amount,
      message,
      deliveryDate,
      occasion,
      purchaseReference,
      paymentMethod,
      transactionId,
    } = certificateData;

    const certificateCode = this.generateCode();
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1); // Valid for 1 year

    const query = `
      INSERT INTO gift_certificates (
        certificate_code, from_name, recipient_name, recipient_email,
        amount, message, delivery_date, occasion, purchase_reference,
        payment_method, transaction_id, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;

    const values = [
      certificateCode,
      fromName,
      recipientName,
      recipientEmail,
      amount,
      message || null,
      deliveryDate || null,
      occasion || null,
      purchaseReference || null,
      paymentMethod || null,
      transactionId || null,
      expiresAt,
    ];

    try {
      const { rows } = await pool.query(query, values);
      return rows[0];
    } catch (error) {
      console.error("Error creating gift certificate:", error);
      throw error;
    }
  }

  static async findAll(filters = {}) {
    const { status, occasion, page = 1, limit = 50 } = filters;
    const offset = (Number(page) - 1) * Number(limit);

    let query = `
      SELECT 
        id, certificate_code, amount, from_name, recipient_name,
        recipient_email, message, delivery_date, occasion, status,
        purchase_reference, payment_method, transaction_id,
        redeemed_at, redeemed_by, booking_id, expires_at,
        admin_notes, created_at, updated_at
      FROM gift_certificates
      WHERE 1=1
    `;

    const conditions = [];
    const params = [];
    let paramCount = 1;

    if (status) {
      conditions.push(`status = $${paramCount++}`);
      params.push(status);
    }

    if (occasion) {
      conditions.push(`occasion = $${paramCount++}`);
      params.push(occasion);
    }

    if (conditions.length) {
      query += ` AND ${conditions.join(" AND ")}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(limit, offset);

    // Count query for pagination
    let countQuery = `
      SELECT COUNT(*) FROM gift_certificates WHERE 1=1
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
        certificates: rows,
        total: parseInt(countRows[0].count),
        page: Number(page),
        limit: Number(limit),
      };
    } catch (error) {
      console.error("Error fetching gift certificates:", error);
      throw error;
    }
  }

  static async findById(id) {
    const query = `
      SELECT 
        id, certificate_code, amount, from_name, recipient_name,
        recipient_email, message, delivery_date, occasion, status,
        purchase_reference, payment_method, transaction_id,
        redeemed_at, redeemed_by, booking_id, expires_at,
        admin_notes, created_at, updated_at
      FROM gift_certificates
      WHERE id = $1
    `;

    try {
      const { rows } = await pool.query(query, [id]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error finding gift certificate by ID:", error);
      throw error;
    }
  }

  static async findByCode(code) {
    const query = `
      SELECT * FROM gift_certificates WHERE certificate_code = $1
    `;

    try {
      const { rows } = await pool.query(query, [code]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error finding gift certificate by code:", error);
      throw error;
    }
  }

  static async findByEmail(email) {
    const query = `
      SELECT * FROM gift_certificates WHERE recipient_email = $1
      ORDER BY created_at DESC
    `;

    try {
      const { rows } = await pool.query(query, [email]);
      return rows;
    } catch (error) {
      console.error("Error finding gift certificates by email:", error);
      throw error;
    }
  }

  static async updateStatus(id, status, adminNotes = null) {
    const query = `
      UPDATE gift_certificates 
      SET status = $1,
          admin_notes = COALESCE($2, admin_notes),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `;

    try {
      const { rows } = await pool.query(query, [status, adminNotes, id]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error updating gift certificate status:", error);
      throw error;
    }
  }

  static async redeemCertificate(code, userId, bookingId) {
    const query = `
      UPDATE gift_certificates 
      SET status = 'redeemed',
          redeemed_at = CURRENT_TIMESTAMP,
          redeemed_by = $1,
          booking_id = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE certificate_code = $3
        AND status = 'active'
        AND expires_at > CURRENT_TIMESTAMP
      RETURNING *
    `;

    try {
      const { rows } = await pool.query(query, [userId, bookingId, code]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error redeeming gift certificate:", error);
      throw error;
    }
  }

  static async updateAdminNotes(id, notes) {
    const query = `
      UPDATE gift_certificates 
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
    const query = `DELETE FROM gift_certificates WHERE id = $1 RETURNING *`;

    try {
      const { rows } = await pool.query(query, [id]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error deleting gift certificate:", error);
      throw error;
    }
  }

  static async getStats() {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
        COUNT(CASE WHEN status = 'redeemed' THEN 1 END) as redeemed,
        COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
        SUM(CASE WHEN status = 'active' THEN amount ELSE 0 END) as active_value,
        SUM(CASE WHEN status = 'redeemed' THEN amount ELSE 0 END) as redeemed_value,
        AVG(amount) as avg_value
      FROM gift_certificates
    `;

    try {
      const { rows } = await pool.query(query);
      return rows[0];
    } catch (error) {
      console.error("Error getting gift certificate stats:", error);
      throw error;
    }
  }

  static async getOccasionStats() {
    const query = `
      SELECT 
        occasion,
        COUNT(*) as count,
        SUM(amount) as total_value
      FROM gift_certificates
      WHERE occasion IS NOT NULL
      GROUP BY occasion
      ORDER BY count DESC
    `;

    try {
      const { rows } = await pool.query(query);
      return rows;
    } catch (error) {
      console.error("Error getting occasion stats:", error);
      throw error;
    }
  }
}

export default GiftCertificate;
