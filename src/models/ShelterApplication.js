// src/models/ShelterApplication.js
import pool from "../config/database.js";

class ShelterApplication {
  static async create(applicationData) {
    const {
      organisationName,
      contactName,
      email,
      phone,
      city,
      organisationType,
      supportType,
      residentCount,
      message,
    } = applicationData;

    // Generate unique reference number
    const referenceNumber = `SHL-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

    const query = `
      INSERT INTO shelter_applications (
        organisation_name, contact_name, email, phone, city,
        organisation_type, support_type, resident_count, message, reference_number
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const values = [
      organisationName,
      contactName,
      email,
      phone,
      city,
      organisationType || null,
      supportType,
      residentCount || null,
      message,
      referenceNumber,
    ];

    try {
      const { rows } = await pool.query(query, values);
      return rows[0];
    } catch (error) {
      console.error("Error creating shelter application:", error);
      throw error;
    }
  }

  static async findAll(filters = {}) {
    const { status, city, supportType, page = 1, limit = 50 } = filters;
    const offset = (Number(page) - 1) * Number(limit);

    let query = `
      SELECT 
        id, organisation_name, contact_name, email, phone, city,
        organisation_type, support_type, resident_count, message,
        status, admin_notes, reference_number, reviewed_at,
        created_at, updated_at
      FROM shelter_applications
      WHERE 1=1
    `;

    const conditions = [];
    const params = [];
    let paramCount = 1;

    if (status) {
      conditions.push(`status = $${paramCount++}`);
      params.push(status);
    }

    if (city) {
      conditions.push(`city = $${paramCount++}`);
      params.push(city);
    }

    if (supportType) {
      conditions.push(`support_type = $${paramCount++}`);
      params.push(supportType);
    }

    if (conditions.length) {
      query += ` AND ${conditions.join(" AND ")}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(limit, offset);

    // Count query for pagination
    let countQuery = `
      SELECT COUNT(*) FROM shelter_applications WHERE 1=1
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
        applications: rows,
        total: parseInt(countRows[0].count),
        page: Number(page),
        limit: Number(limit),
      };
    } catch (error) {
      console.error("Error fetching shelter applications:", error);
      throw error;
    }
  }

  static async findById(id) {
    const query = `
      SELECT 
        id, organisation_name, contact_name, email, phone, city,
        organisation_type, support_type, resident_count, message,
        status, admin_notes, reference_number, reviewed_at,
        created_at, updated_at
      FROM shelter_applications
      WHERE id = $1
    `;

    try {
      const { rows } = await pool.query(query, [id]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error finding shelter application by ID:", error);
      throw error;
    }
  }

  static async findByEmail(email) {
    const query = `
      SELECT * FROM shelter_applications WHERE email = $1
      ORDER BY created_at DESC
    `;

    try {
      const { rows } = await pool.query(query, [email]);
      return rows;
    } catch (error) {
      console.error("Error finding shelter applications by email:", error);
      throw error;
    }
  }

  static async updateStatus(id, status, adminNotes = null, reviewedBy = null) {
    const query = `
      UPDATE shelter_applications 
      SET status = $1, 
          admin_notes = COALESCE($2, admin_notes),
          reviewed_at = CURRENT_TIMESTAMP,
          reviewed_by = COALESCE($3, reviewed_by),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `;

    try {
      const { rows } = await pool.query(query, [
        status,
        adminNotes,
        reviewedBy,
        id,
      ]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error updating shelter application status:", error);
      throw error;
    }
  }

  static async updateAdminNotes(id, notes) {
    const query = `
      UPDATE shelter_applications 
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
    const query = `DELETE FROM shelter_applications WHERE id = $1 RETURNING *`;

    try {
      const { rows } = await pool.query(query, [id]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error deleting shelter application:", error);
      throw error;
    }
  }

  static async getStats() {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'reviewed' THEN 1 END) as reviewed,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
        COUNT(DISTINCT city) as unique_cities,
        COUNT(DISTINCT support_type) as unique_support_types
      FROM shelter_applications
    `;

    try {
      const { rows } = await pool.query(query);
      return rows[0];
    } catch (error) {
      console.error("Error getting shelter application stats:", error);
      throw error;
    }
  }

  static async getSupportTypeStats() {
    const query = `
      SELECT 
        support_type,
        COUNT(*) as count
      FROM shelter_applications
      GROUP BY support_type
      ORDER BY count DESC
    `;

    try {
      const { rows } = await pool.query(query);
      return rows;
    } catch (error) {
      console.error("Error getting support type stats:", error);
      throw error;
    }
  }

  static async getCityStats() {
    const query = `
      SELECT 
        city,
        COUNT(*) as count
      FROM shelter_applications
      GROUP BY city
      ORDER BY count DESC
    `;

    try {
      const { rows } = await pool.query(query);
      return rows;
    } catch (error) {
      console.error("Error getting city stats:", error);
      throw error;
    }
  }
}

export default ShelterApplication;
