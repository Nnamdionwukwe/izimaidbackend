// src/models/ContactMessage.js
import pool from "../config/database.js";

class ContactMessage {
  static async create(messageData) {
    const { fullName, email, phone, subject, message } = messageData;

    // Generate unique reference number
    const referenceNumber = `CMS-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

    const query = `
      INSERT INTO contact_messages (
        full_name, email, phone, subject, message, reference_number
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const values = [
      fullName,
      email,
      phone || null,
      subject,
      message,
      referenceNumber,
    ];

    try {
      const { rows } = await pool.query(query, values);
      return rows[0];
    } catch (error) {
      console.error("Error creating contact message:", error);
      throw error;
    }
  }

  static async findAll(filters = {}) {
    const { status, subject, page = 1, limit = 50 } = filters;
    const offset = (Number(page) - 1) * Number(limit);

    let query = `
      SELECT 
        id, full_name, email, phone, subject, message, status,
        admin_notes, reference_number, replied_at,
        created_at, updated_at
      FROM contact_messages
      WHERE 1=1
    `;

    const conditions = [];
    const params = [];
    let paramCount = 1;

    if (status) {
      conditions.push(`status = $${paramCount++}`);
      params.push(status);
    }

    if (subject) {
      conditions.push(`subject = $${paramCount++}`);
      params.push(subject);
    }

    if (conditions.length) {
      query += ` AND ${conditions.join(" AND ")}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(limit, offset);

    // Count query for pagination
    let countQuery = `
      SELECT COUNT(*) FROM contact_messages WHERE 1=1
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
        messages: rows,
        total: parseInt(countRows[0].count),
        page: Number(page),
        limit: Number(limit),
      };
    } catch (error) {
      console.error("Error fetching contact messages:", error);
      throw error;
    }
  }

  static async findById(id) {
    const query = `
      SELECT 
        id, full_name, email, phone, subject, message, status,
        admin_notes, reference_number, replied_at,
        created_at, updated_at
      FROM contact_messages
      WHERE id = $1
    `;

    try {
      const { rows } = await pool.query(query, [id]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error finding contact message by ID:", error);
      throw error;
    }
  }

  static async findByEmail(email) {
    const query = `
      SELECT * FROM contact_messages WHERE email = $1
      ORDER BY created_at DESC
    `;

    try {
      const { rows } = await pool.query(query, [email]);
      return rows;
    } catch (error) {
      console.error("Error finding contact messages by email:", error);
      throw error;
    }
  }

  static async updateStatus(id, status, adminNotes = null, repliedBy = null) {
    // Explicitly cast status to text to avoid type mismatch
    const statusValue = String(status);

    const query = `
      UPDATE contact_messages 
      SET status = $1::text, 
          admin_notes = COALESCE($2, admin_notes),
          replied_at = CASE WHEN $1::text IN ('replied', 'resolved') THEN CURRENT_TIMESTAMP ELSE replied_at END,
          replied_by = COALESCE($3, replied_by),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `;

    // Handle UUID or object for replied_by
    let replierId = repliedBy;
    if (replierId && typeof replierId === "object" && replierId.id) {
      replierId = replierId.id;
    }
    // If it's a UUID string, keep it as is
    // If it's null or undefined, pass null

    try {
      const { rows } = await pool.query(query, [
        statusValue,
        adminNotes,
        replierId,
        id,
      ]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error updating contact message status:", error);
      throw error;
    }
  }

  static async updateAdminNotes(id, notes) {
    const query = `
      UPDATE contact_messages 
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
    const query = `DELETE FROM contact_messages WHERE id = $1 RETURNING *`;

    try {
      const { rows } = await pool.query(query, [id]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error deleting contact message:", error);
      throw error;
    }
  }

  static async getStats() {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'new' THEN 1 END) as new,
        COUNT(CASE WHEN status = 'read' THEN 1 END) as read,
        COUNT(CASE WHEN status = 'replied' THEN 1 END) as replied,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved,
        COUNT(CASE WHEN status = 'archived' THEN 1 END) as archived,
        COUNT(DISTINCT subject) as unique_subjects
      FROM contact_messages
    `;

    try {
      const { rows } = await pool.query(query);
      return rows[0];
    } catch (error) {
      console.error("Error getting contact message stats:", error);
      throw error;
    }
  }

  static async getSubjectStats() {
    const query = `
      SELECT 
        subject,
        COUNT(*) as count
      FROM contact_messages
      GROUP BY subject
      ORDER BY count DESC
    `;

    try {
      const { rows } = await pool.query(query);
      return rows;
    } catch (error) {
      console.error("Error getting subject stats:", error);
      throw error;
    }
  }
}

export default ContactMessage;
