// src/models/HousekeeperApplication.js
import pool from "../config/database.js";

class HousekeeperApplication {
  static async create(applicationData) {
    const {
      fullName,
      email,
      phone,
      city,
      preferredTrack,
      experienceLevel,
      motivation,
      availability,
    } = applicationData;

    // Generate unique reference number
    const referenceNumber = `DHA-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

    const query = `
      INSERT INTO housekeeper_applications (
        full_name, email, phone, city, preferred_track, 
        experience_level, motivation, availability, reference_number
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const values = [
      fullName,
      email,
      phone,
      city,
      preferredTrack,
      experienceLevel || null,
      motivation,
      availability || [],
      referenceNumber,
    ];

    try {
      const { rows } = await pool.query(query, values);
      return rows[0];
    } catch (error) {
      console.error("Error creating housekeeper application:", error);
      throw error;
    }
  }

  static async findAll(filters = {}) {
    const { status, city, track, page = 1, limit = 50 } = filters;
    const offset = (Number(page) - 1) * Number(limit);

    let query = `
      SELECT 
        id, full_name, email, phone, city, preferred_track,
        experience_level, motivation, availability, status,
        admin_notes, reference_number, application_date,
        reviewed_at, created_at, updated_at
      FROM housekeeper_applications
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

    if (track) {
      conditions.push(`preferred_track = $${paramCount++}`);
      params.push(track);
    }

    if (conditions.length) {
      query += ` AND ${conditions.join(" AND ")}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(limit, offset);

    // Count query for pagination
    let countQuery = `
      SELECT COUNT(*) FROM housekeeper_applications WHERE 1=1
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
      console.error("Error fetching housekeeper applications:", error);
      throw error;
    }
  }

  static async findById(id) {
    const query = `
      SELECT 
        id, full_name, email, phone, city, preferred_track,
        experience_level, motivation, availability, status,
        admin_notes, reference_number, application_date,
        reviewed_at, created_at, updated_at
      FROM housekeeper_applications
      WHERE id = $1
    `;

    try {
      const { rows } = await pool.query(query, [id]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error finding housekeeper application by ID:", error);
      throw error;
    }
  }

  static async findByEmail(email) {
    const query = `
      SELECT * FROM housekeeper_applications WHERE email = $1
      ORDER BY created_at DESC
    `;

    try {
      const { rows } = await pool.query(query, [email]);
      return rows;
    } catch (error) {
      console.error("Error finding housekeeper application by email:", error);
      throw error;
    }
  }

  static async updateStatus(id, status, adminNotes = null, reviewedBy = null) {
    const query = `
      UPDATE housekeeper_applications 
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
      console.error("Error updating housekeeper application status:", error);
      throw error;
    }
  }

  static async updateAdminNotes(id, notes) {
    const query = `
      UPDATE housekeeper_applications 
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
    const query = `DELETE FROM housekeeper_applications WHERE id = $1 RETURNING *`;

    try {
      const { rows } = await pool.query(query, [id]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error deleting housekeeper application:", error);
      throw error;
    }
  }

  static async getStats() {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'reviewed' THEN 1 END) as reviewed,
        COUNT(CASE WHEN status = 'accepted' THEN 1 END) as accepted,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
        COUNT(CASE WHEN status = 'enrolled' THEN 1 END) as enrolled
      FROM housekeeper_applications
    `;

    try {
      const { rows } = await pool.query(query);
      return rows[0];
    } catch (error) {
      console.error("Error getting housekeeper application stats:", error);
      throw error;
    }
  }
}

export default HousekeeperApplication;
