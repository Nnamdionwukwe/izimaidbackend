import db from "../config/database.js";
import {
  uploadMediaToCloudinary,
  deleteMediaFromCloudinary,
  validateMediaFile,
} from "../utils/cloudinary-utils.js";

import {
  sendMaidTicketCreatedEmail,
  sendMaidTicketReplyEmail,
  sendMaidTicketStatusEmail,
} from "../utils/mailer.js";

// Create a new maid support ticket
export async function createMaidSupportTicket(req, res) {
  try {
    const { subject, message, category, priority } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!subject || !message || !category) {
      return res.status(400).json({
        error: "Subject, message, and category are required",
      });
    }

    // Validate priority (default: normal)
    const validPriorities = ["low", "normal", "high", "urgent"];
    const ticketPriority =
      priority && validPriorities.includes(priority) ? priority : "normal";

    const result = await db.query(
      `INSERT INTO maid_support_tickets 
        (user_id, subject, message, category, priority, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [userId, subject, message, category, ticketPriority],
    );

    (async () => {
      try {
        const { rows: userRows } = await db.query(
          `SELECT name, email FROM users WHERE id = $1`,
          [userId],
        );
        if (userRows[0]) {
          sendMaidTicketCreatedEmail(userRows[0], result.rows[0]).catch(
            console.error,
          );
        }
        const { rows: admins } = await db.query(
          `SELECT name, email FROM users WHERE role = 'admin' AND is_active = true`,
        );
        for (const admin of admins) {
          sendEmail({
            to: admin.email,
            subject: `New maid support ticket — ${process.env.APP_NAME}`,
            html: `<p>New maid ticket. Subject: <strong>${result.rows[0].subject}</strong>. Category: ${result.rows[0].category}.</p>`,
          }).catch(console.error);
        }
      } catch (e) {
        console.error("[maid-support/email]", e);
      }
    })();

    res.status(201).json({
      message: "Support ticket created successfully",
      ticket: result.rows[0],
    });
  } catch (err) {
    console.error("Error creating maid support ticket:", err);
    res.status(500).json({ error: "Failed to create support ticket" });
  }
}

// Get maid support tickets

export async function getMaidSupportTickets(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { page = 1, limit = 10, status, category, sort = "desc" } = req.query;

    const offset = (page - 1) * limit;

    let query = `
      SELECT t.*,
        (SELECT COUNT(*) FROM maid_support_replies r WHERE r.ticket_id = t.id)::int AS reply_count
      FROM maid_support_tickets t
    `;
    const params = [];

    // Maids see only their tickets, admins see all
    if (userRole !== "admin") {
      query += ` WHERE t.user_id = $1`;
      params.push(userId);
    }

    // Filter by status
    if (status) {
      if (userRole !== "admin") {
        query += ` AND t.status = $${params.length + 1}`;
      } else {
        query += ` WHERE t.status = $${params.length + 1}`;
      }
      params.push(status);
    }

    // Filter by category
    if (category) {
      query += ` AND t.category = $${params.length + 1}`;
      params.push(category);
    }

    // Sort + paginate
    const sortOrder = sort === "asc" ? "ASC" : "DESC";
    query += ` ORDER BY t.created_at ${sortOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    // Count query (unchanged logic, just uses alias t)
    let countQuery = `SELECT COUNT(*) FROM maid_support_tickets t`;
    const countParams = [];

    if (userRole !== "admin") {
      countQuery += ` WHERE t.user_id = $1`;
      countParams.push(userId);
    }

    if (status) {
      if (userRole !== "admin") {
        countQuery += ` AND t.status = $${countParams.length + 1}`;
      } else {
        countQuery += ` WHERE t.status = $${countParams.length + 1}`;
      }
      countParams.push(status);
    }

    if (category) {
      countQuery += ` AND t.category = $${countParams.length + 1}`;
      countParams.push(category);
    }

    const countResult = await db.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count, 10);

    res.json({
      tickets: result.rows, // each ticket now has reply_count ✅
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("Error fetching maid support tickets:", err);
    res.status(500).json({ error: "Failed to fetch support tickets" });
  }
}

// Get single maid support ticket with replies
export async function getMaidSupportTicket(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Get ticket
    const ticketResult = await db.query(
      `SELECT * FROM maid_support_tickets WHERE id = $1`,
      [id],
    );

    if (ticketResult.rows.length === 0) {
      return res.status(404).json({ error: "Support ticket not found" });
    }

    const ticket = ticketResult.rows[0];

    // Check authorization
    if (userRole !== "admin" && ticket.user_id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Get replies
    const repliesResult = await db.query(
      `SELECT * FROM maid_support_replies WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [id],
    );

    // Get attachments
    const attachmentsResult = await db.query(
      `SELECT * FROM support_ticket_attachments WHERE ticket_id = $1 AND ticket_type = 'maid' ORDER BY created_at DESC`,
      [id],
    );

    res.json({
      ticket,
      replies: repliesResult.rows,
      attachments: attachmentsResult.rows,
    });
  } catch (err) {
    console.error("Error fetching maid support ticket:", err);
    res.status(500).json({ error: "Failed to fetch support ticket" });
  }
}

// Upload media attachment to maid support ticket
export async function uploadMaidTicketMedia(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file provided" });
    }

    // Determine media type from file
    const isVideo = file.mimetype.startsWith("video/");
    const mediaType = isVideo ? "video" : "image";

    // Validate file
    const validation = validateMediaFile(file, mediaType);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    // Check if ticket exists and user has access
    const ticketResult = await db.query(
      `SELECT * FROM maid_support_tickets WHERE id = $1`,
      [id],
    );

    if (ticketResult.rows.length === 0) {
      return res.status(404).json({ error: "Support ticket not found" });
    }

    const ticket = ticketResult.rows[0];

    if (userRole !== "admin" && ticket.user_id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Upload to Cloudinary
    const uploadResult = await uploadMediaToCloudinary(
      file.buffer,
      mediaType,
      `support-tickets/maid/${id}`,
    );

    // Save attachment to database
    const attachmentResult = await db.query(
      `INSERT INTO support_ticket_attachments 
        (ticket_id, ticket_type, user_id, media_url, media_type, file_name, file_size, created_at)
       VALUES ($1, 'maid', $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        id,
        userId,
        uploadResult.url,
        mediaType,
        file.originalname,
        uploadResult.size,
      ],
    );

    // Update attachment count
    await db.query(
      `UPDATE maid_support_tickets SET attachment_count = attachment_count + 1 WHERE id = $1`,
      [id],
    );

    res.status(201).json({
      message: "Media uploaded successfully",
      attachment: attachmentResult.rows[0],
    });
  } catch (err) {
    console.error("Error uploading maid ticket media:", err);
    res.status(500).json({ error: "Failed to upload media" });
  }
}

// Delete media attachment from maid support ticket
export async function deleteMaidTicketMedia(req, res) {
  try {
    const { ticketId, attachmentId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Get attachment
    const attachmentResult = await db.query(
      `SELECT * FROM support_ticket_attachments WHERE id = $1 AND ticket_id = $2`,
      [attachmentId, ticketId],
    );

    if (attachmentResult.rows.length === 0) {
      return res.status(404).json({ error: "Attachment not found" });
    }

    const attachment = attachmentResult.rows[0];

    // Check authorization
    if (userRole !== "admin" && attachment.user_id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Delete from Cloudinary
    const publicId = attachment.media_url.split("/").pop().split(".")[0];
    await deleteMediaFromCloudinary(publicId, attachment.media_type);

    // Delete from database
    await db.query(`DELETE FROM support_ticket_attachments WHERE id = $1`, [
      attachmentId,
    ]);

    // Update attachment count
    await db.query(
      `UPDATE maid_support_tickets SET attachment_count = GREATEST(0, attachment_count - 1) WHERE id = $1`,
      [ticketId],
    );

    res.json({
      message: "Media deleted successfully",
    });
  } catch (err) {
    console.error("Error deleting maid ticket media:", err);
    res.status(500).json({ error: "Failed to delete media" });
  }
}

// Update maid support ticket status (admin only)
export async function updateMaidSupportTicket(req, res) {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({ error: "Status is required" });
    }

    const validStatuses = ["open", "in_progress", "resolved", "closed"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const result = await db.query(
      `UPDATE maid_support_tickets 
       SET status = $1, admin_notes = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [status, notes || null, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Support ticket not found" });
    }

    (async () => {
      try {
        const { rows: maidRows } = await db.query(
          `SELECT u.name, u.email FROM users u
           JOIN maid_support_tickets t ON t.user_id = u.id
           WHERE t.id = $1`,
          [id],
        );
        if (
          maidRows[0] &&
          ["in_progress", "resolved", "closed"].includes(status)
        ) {
          sendMaidTicketStatusEmail(maidRows[0], result.rows[0], status).catch(
            console.error,
          );
        }
      } catch (e) {
        console.error("[maid-support/status/email]", e);
      }
    })();

    res.json({
      message: "Support ticket updated successfully",
      ticket: result.rows[0],
    });
  } catch (err) {
    console.error("Error updating maid support ticket:", err);
    res.status(500).json({ error: "Failed to update support ticket" });
  }
}

// Add reply to maid support ticket
export async function replyMaidSupportTicket(req, res) {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Check if ticket exists
    const ticketResult = await db.query(
      `SELECT * FROM maid_support_tickets WHERE id = $1`,
      [id],
    );

    if (ticketResult.rows.length === 0) {
      return res.status(404).json({ error: "Support ticket not found" });
    }

    const ticket = ticketResult.rows[0];

    // Check authorization
    if (userRole !== "admin" && ticket.user_id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Create reply
    const result = await db.query(
      `INSERT INTO maid_support_replies (ticket_id, user_id, message, created_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       RETURNING *`,
      [id, userId, message],
    );

    // Update ticket's updated_at timestamp
    await db.query(
      `UPDATE maid_support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id],
    );

    (async () => {
      try {
        const replierRows = await db.query(
          `SELECT name FROM users WHERE id = $1`,
          [userId],
        );
        const replierName = replierRows.rows[0]?.name || "Support Team";

        if (userRole === "admin") {
          const { rows: maidRows } = await db.query(
            `SELECT name, email FROM users WHERE id = $1`,
            [ticket.user_id],
          );
          if (maidRows[0]) {
            sendMaidTicketReplyEmail(
              maidRows[0],
              ticket,
              message,
              replierName,
            ).catch(console.error);
          }
        } else {
          const { rows: admins } = await db.query(
            `SELECT name, email FROM users WHERE role = 'admin' AND is_active = true`,
          );
          for (const admin of admins) {
            sendEmail({
              to: admin.email,
              subject: `Maid replied to support ticket — ${process.env.APP_NAME}`,
              html: `<p>Maid replied to ticket: <strong>${ticket.subject}</strong>.</p><p>${message}</p>`,
            }).catch(console.error);
          }
        }
      } catch (e) {
        console.error("[maid-support/reply/email]", e);
      }
    })();

    res.status(201).json({
      message: "Reply added successfully",
      reply: result.rows[0],
    });
  } catch (err) {
    console.error("Error adding maid support reply:", err);
    res.status(500).json({ error: "Failed to add reply" });
  }
}

// Delete maid support ticket
export async function deleteMaidSupportTicket(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check if ticket exists
    const ticketResult = await db.query(
      `SELECT * FROM maid_support_tickets WHERE id = $1`,
      [id],
    );

    if (ticketResult.rows.length === 0) {
      return res.status(404).json({ error: "Support ticket not found" });
    }

    const ticket = ticketResult.rows[0];

    // Check authorization
    if (userRole !== "admin" && ticket.user_id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Get all attachments and delete from Cloudinary
    const attachmentsResult = await db.query(
      `SELECT * FROM support_ticket_attachments WHERE ticket_id = $1`,
      [id],
    );

    for (const attachment of attachmentsResult.rows) {
      const publicId = attachment.media_url.split("/").pop().split(".")[0];
      try {
        await deleteMediaFromCloudinary(publicId, attachment.media_type);
      } catch (err) {
        console.error("Error deleting media from Cloudinary:", err);
      }
    }

    // Delete replies first (foreign key constraint)
    await db.query(`DELETE FROM maid_support_replies WHERE ticket_id = $1`, [
      id,
    ]);

    // Delete attachments
    await db.query(
      `DELETE FROM support_ticket_attachments WHERE ticket_id = $1`,
      [id],
    );

    // Delete ticket
    const result = await db.query(
      `DELETE FROM maid_support_tickets WHERE id = $1 RETURNING *`,
      [id],
    );

    res.json({
      message: "Support ticket deleted successfully",
      ticket: result.rows[0],
    });
  } catch (err) {
    console.error("Error deleting maid support ticket:", err);
    res.status(500).json({ error: "Failed to delete support ticket" });
  }
}

// Get maid support statistics (admin only)
export async function getMaidSupportStats(req, res) {
  try {
    const statsResult = await db.query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_count
       FROM maid_support_tickets`,
    );

    res.json(statsResult.rows[0]);
  } catch (err) {
    console.error("Error fetching maid support stats:", err);
    res.status(500).json({ error: "Failed to fetch support statistics" });
  }
}
