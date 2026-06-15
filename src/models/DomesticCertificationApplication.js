// src/models/DomesticCertificationApplication.js
import pool from "../config/database.js";

class DomesticCertificationApplication {
  static async create(applicationData) {
    const {
      fullName,
      email,
      phone,
      city,
      programChoice,
      experienceLevel,
      educationLevel,
      previousTraining,
      schedulePreference,
      startMonth,
      motivation,
      referralCode,
      hearAbout,
      emergencyContact,
      emergencyPhone,
    } = applicationData;

    // Generate unique reference number
    const referenceNumber = `DSA-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

    const query = `
      INSERT INTO domestic_certification_applications (
        full_name, email, phone, city, program_choice, 
        experience_level, education_level, previous_training,
        schedule_preference, start_month, motivation, referral_code,
        hear_about, emergency_contact, emergency_phone, reference_number
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `;

    const values = [
      fullName,
      email,
      phone,
      city,
      programChoice,
      experienceLevel || null,
      educationLevel || null,
      previousTraining || null,
      schedulePreference || null,
      startMonth || null,
      motivation,
      referralCode || null,
      hearAbout || null,
      emergencyContact || null,
      emergencyPhone || null,
      referenceNumber,
    ];

    try {
      const { rows } = await pool.query(query, values);
      return rows[0];
    } catch (error) {
      console.error(
        "Error creating domestic certification application:",
        error,
      );
      throw error;
    }
  }

  static async findAll(filters = {}) {
    const { status, city, program, page = 1, limit = 50 } = filters;
    const offset = (Number(page) - 1) * Number(limit);

    let query = `
      SELECT 
        id, full_name, email, phone, city, program_choice,
        experience_level, education_level, previous_training,
        schedule_preference, start_month, motivation, referral_code,
        hear_about, emergency_contact, emergency_phone, status,
        admin_notes, reference_number, application_date,
        reviewed_at, created_at, updated_at
      FROM domestic_certification_applications
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

    if (program) {
      conditions.push(`program_choice = $${paramCount++}`);
      params.push(program);
    }

    if (conditions.length) {
      query += ` AND ${conditions.join(" AND ")}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(limit, offset);

    // Count query for pagination
    let countQuery = `
      SELECT COUNT(*) FROM domestic_certification_applications WHERE 1=1
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
      console.error(
        "Error fetching domestic certification applications:",
        error,
      );
      throw error;
    }
  }

  static async findById(id) {
    const query = `
      SELECT 
        id, full_name, email, phone, city, program_choice,
        experience_level, education_level, previous_training,
        schedule_preference, start_month, motivation, referral_code,
        hear_about, emergency_contact, emergency_phone, status,
        admin_notes, reference_number, application_date,
        reviewed_at, created_at, updated_at
      FROM domestic_certification_applications
      WHERE id = $1
    `;

    try {
      const { rows } = await pool.query(query, [id]);
      return rows[0] || null;
    } catch (error) {
      console.error(
        "Error finding domestic certification application by ID:",
        error,
      );
      throw error;
    }
  }

  static async findByEmail(email) {
    const query = `
      SELECT * FROM domestic_certification_applications WHERE email = $1
      ORDER BY created_at DESC
    `;

    try {
      const { rows } = await pool.query(query, [email]);
      return rows;
    } catch (error) {
      console.error(
        "Error finding domestic certification application by email:",
        error,
      );
      throw error;
    }
  }

  static async updateStatus(id, status, adminNotes = null, reviewedBy = null) {
    const query = `
      UPDATE domestic_certification_applications 
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
      console.error(
        "Error updating domestic certification application status:",
        error,
      );
      throw error;
    }
  }

  static async updateAdminNotes(id, notes) {
    const query = `
      UPDATE domestic_certification_applications 
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
    const query = `DELETE FROM domestic_certification_applications WHERE id = $1 RETURNING *`;

    try {
      const { rows } = await pool.query(query, [id]);
      return rows[0] || null;
    } catch (error) {
      console.error(
        "Error deleting domestic certification application:",
        error,
      );
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
      FROM domestic_certification_applications
    `;

    try {
      const { rows } = await pool.query(query);
      return rows[0];
    } catch (error) {
      console.error(
        "Error getting domestic certification application stats:",
        error,
      );
      throw error;
    }
  }
}

export default DomesticCertificationApplication;
