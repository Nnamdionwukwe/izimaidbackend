import db from "../config/database.js";
import {
  uploadMediaToCloudinary,
  deleteMediaFromCloudinary,
  validateMediaFile,
} from "../utils/cloudinary-utils.js";

import {
  sendEmail,
  sendCustomerTicketCreatedEmail,
  sendCustomerTicketReplyEmail,
  sendCustomerTicketStatusEmail,
} from "../utils/mailer.js";

import { notify, notifyAdmins } from "../utils/notify.js";

export async function createCustomerSupportTicket(req, res) {
  try {
    const { subject, message, category, priority } = req.body;
    const userId = req.user.id;

    if (!subject || !message || !category) {
      return res
        .status(400)
        .json({ error: "Subject, message, and category are required" });
    }

    const validPriorities = ["low", "normal", "high", "urgent"];
    const ticketPriority = validPriorities.includes(priority)
      ? priority
      : "normal";

    const result = await db.query(
      `INSERT INTO customer_support_tickets
         (user_id, subject, message, category, priority, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [userId, subject, message, category, ticketPriority],
    );

    const ticket = result.rows[0];

    // ── In-app + email: customer confirmation ─────────────────────────
    await notify(db, {
      userId,
      type: "ticket_created",
      title: "Support ticket received 🎫",
      body: `Your ticket "${subject}" has been submitted. We'll respond within 24 hours.`,
      action_url: `/support/tickets/${ticket.id}`,
      sendMail: async () => {
        const { rows } = await db.query(
          `SELECT name, email FROM users WHERE id = $1`,
          [userId],
        );
        if (rows[0]) return sendCustomerTicketCreatedEmail(rows[0], ticket);
      },
    });

    // ── In-app + email: notify all admins ─────────────────────────────
    await notifyAdmins(db, {
      type: "ticket_created",
      title: `New customer support ticket 🎫`,
      body: `${req.user.name || "A customer"} opened a ticket: "${subject}" (${category}, ${ticketPriority})`,
      action_url: `/admin/support/${ticket.id}`,
      priority: ticketPriority === "urgent" ? "high" : "normal",
      sendMail: async () => {
        const { rows: admins } = await db.query(
          `SELECT name, email FROM users WHERE role = 'admin' AND is_active = true`,
        );
        for (const admin of admins) {
          await sendEmail({
            to: admin.email,
            subject: `New customer support ticket — ${process.env.APP_NAME}`,
            html: `<p>New ticket from customer. Subject: <strong>${subject}</strong>. Category: ${category}. Priority: ${ticketPriority}.</p>`,
          });
        }
      },
    });

    res
      .status(201)
      .json({ message: "Support ticket created successfully", ticket });
  } catch (err) {
    console.error("Error creating customer support ticket:", err);
    res.status(500).json({ error: "Failed to create support ticket" });
  }
}

// ─────────────────────────────────────────────────────────────────────
export async function getCustomerSupportTickets(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { page = 1, limit = 10, status, category, sort = "desc" } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT t.*,
        (SELECT COUNT(*) FROM customer_support_replies r WHERE r.ticket_id = t.id)::int AS reply_count
      FROM customer_support_tickets t
    `;
    const params = [];

    if (userRole !== "admin") {
      query += ` WHERE t.user_id = $1`;
      params.push(userId);
    }
    if (status) {
      query += params.length
        ? ` AND t.status = $${params.length + 1}`
        : ` WHERE t.status = $${params.length + 1}`;
      params.push(status);
    }
    if (category) {
      query += ` AND t.category = $${params.length + 1}`;
      params.push(category);
    }

    query += ` ORDER BY t.created_at ${sort === "asc" ? "ASC" : "DESC"} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    let countQuery = `SELECT COUNT(*) FROM customer_support_tickets`;
    const countParams = [];
    if (userRole !== "admin") {
      countQuery += ` WHERE user_id = $1`;
      countParams.push(userId);
    }
    if (status) {
      countQuery += countParams.length
        ? ` AND status = $${countParams.length + 1}`
        : ` WHERE status = $${countParams.length + 1}`;
      countParams.push(status);
    }
    if (category) {
      countQuery += ` AND category = $${countParams.length + 1}`;
      countParams.push(category);
    }

    const countResult = await db.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count, 10);

    res.json({
      tickets: result.rows,
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("Error fetching customer support tickets:", err);
    res.status(500).json({ error: "Failed to fetch support tickets" });
  }
}

// ─────────────────────────────────────────────────────────────────────
export async function getCustomerSupportTicket(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const ticketResult = await db.query(
      `SELECT * FROM customer_support_tickets WHERE id = $1`,
      [id],
    );
    if (!ticketResult.rows.length)
      return res.status(404).json({ error: "Support ticket not found" });

    const ticket = ticketResult.rows[0];
    if (userRole !== "admin" && ticket.user_id !== userId)
      return res.status(403).json({ error: "Unauthorized" });

    const [repliesResult, attachmentsResult] = await Promise.all([
      db.query(
        `SELECT * FROM customer_support_replies WHERE ticket_id = $1 ORDER BY created_at ASC`,
        [id],
      ),
      db.query(
        `SELECT * FROM support_ticket_attachments WHERE ticket_id = $1 AND ticket_type = 'customer' ORDER BY created_at DESC`,
        [id],
      ),
    ]);

    res.json({
      ticket,
      replies: repliesResult.rows,
      attachments: attachmentsResult.rows,
    });
  } catch (err) {
    console.error("Error fetching customer support ticket:", err);
    res.status(500).json({ error: "Failed to fetch support ticket" });
  }
}

// ─────────────────────────────────────────────────────────────────────
export async function updateCustomerSupportTicket(req, res) {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!status) return res.status(400).json({ error: "Status is required" });

    const validStatuses = ["open", "in_progress", "resolved", "closed"];
    if (!validStatuses.includes(status))
      return res.status(400).json({ error: "Invalid status" });

    const result = await db.query(
      `UPDATE customer_support_tickets
       SET status = $1, admin_notes = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 RETURNING *`,
      [status, notes || null, id],
    );

    if (!result.rows.length)
      return res.status(404).json({ error: "Support ticket not found" });

    const ticket = result.rows[0];

    // ── In-app + email: notify customer of status change ──────────────
    if (["in_progress", "resolved", "closed"].includes(status)) {
      const statusLabels = {
        in_progress: "In Progress ⏳",
        resolved: "Resolved ✅",
        closed: "Closed 🔒",
      };

      await notify(db, {
        userId: ticket.user_id,
        type: "ticket_status",
        title: `Ticket ${statusLabels[status]}`,
        body: `Your support ticket "${ticket.subject}" is now ${status.replace("_", " ")}.`,
        action_url: `/support/tickets/${ticket.id}`,
        sendMail: async () => {
          const { rows } = await db.query(
            `SELECT name, email FROM users WHERE id = $1`,
            [ticket.user_id],
          );
          if (rows[0])
            return sendCustomerTicketStatusEmail(rows[0], ticket, status);
        },
      });
    }

    res.json({ message: "Support ticket updated successfully", ticket });
  } catch (err) {
    console.error("Error updating customer support ticket:", err);
    res.status(500).json({ error: "Failed to update support ticket" });
  }
}

// ─────────────────────────────────────────────────────────────────────
export async function replyCustomerSupportTicket(req, res) {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!message) return res.status(400).json({ error: "Message is required" });

    const ticketResult = await db.query(
      `SELECT * FROM customer_support_tickets WHERE id = $1`,
      [id],
    );
    if (!ticketResult.rows.length)
      return res.status(404).json({ error: "Support ticket not found" });

    const ticket = ticketResult.rows[0];
    if (userRole !== "admin" && ticket.user_id !== userId)
      return res.status(403).json({ error: "Unauthorized" });

    const result = await db.query(
      `INSERT INTO customer_support_replies (ticket_id, user_id, message, created_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING *`,
      [id, userId, message],
    );

    await db.query(
      `UPDATE customer_support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id],
    );

    const { rows: replierRows } = await db.query(
      `SELECT name FROM users WHERE id = $1`,
      [userId],
    );
    const replierName = replierRows[0]?.name || "Support Team";

    if (userRole === "admin") {
      // ── In-app + email: admin replied → notify customer ───────────
      await notify(db, {
        userId: ticket.user_id,
        type: "ticket_reply",
        title: `New reply on your ticket 💬`,
        body: `${replierName} replied to your ticket "${ticket.subject}".`,
        action_url: `/support/tickets/${ticket.id}`,
        sendMail: async () => {
          const { rows } = await db.query(
            `SELECT name, email FROM users WHERE id = $1`,
            [ticket.user_id],
          );
          if (rows[0])
            return sendCustomerTicketReplyEmail(
              rows[0],
              ticket,
              message,
              replierName,
            );
        },
      });
    } else {
      // ── In-app + email: customer replied → notify all admins ──────
      await notifyAdmins(db, {
        type: "ticket_reply",
        title: `Customer replied to ticket 💬`,
        body: `${replierName} replied to ticket "${ticket.subject}".`,
        action_url: `/admin/support/${ticket.id}`,
        sendMail: async () => {
          const { rows: admins } = await db.query(
            `SELECT name, email FROM users WHERE role = 'admin' AND is_active = true`,
          );
          for (const admin of admins) {
            await sendEmail({
              to: admin.email,
              subject: `Customer replied to ticket — ${process.env.APP_NAME}`,
              html: `<p><strong>${replierName}</strong> replied to ticket: <strong>${ticket.subject}</strong>.</p><p>${message}</p>`,
            });
          }
        },
      });
    }

    res
      .status(201)
      .json({ message: "Reply added successfully", reply: result.rows[0] });
  } catch (err) {
    console.error("Error adding customer support reply:", err);
    res.status(500).json({ error: "Failed to add reply" });
  }
}

// ─────────────────────────────────────────────────────────────────────
export async function uploadCustomerTicketMedia(req, res) {
  try {
    const { id } = req.params;
    const {
      user: { id: userId, role: userRole },
    } = req;
    const file = req.file;

    if (!file) return res.status(400).json({ error: "No file provided" });

    const isVideo = file.mimetype.startsWith("video/");
    const mediaType = isVideo ? "video" : "image";
    const validation = validateMediaFile(file, mediaType);
    if (!validation.valid)
      return res.status(400).json({ error: validation.error });

    const ticketResult = await db.query(
      `SELECT * FROM customer_support_tickets WHERE id = $1`,
      [id],
    );
    if (!ticketResult.rows.length)
      return res.status(404).json({ error: "Support ticket not found" });
    if (userRole !== "admin" && ticketResult.rows[0].user_id !== userId)
      return res.status(403).json({ error: "Unauthorized" });

    const uploadResult = await uploadMediaToCloudinary(
      file.buffer,
      mediaType,
      `support-tickets/customer/${id}`,
    );

    const attachmentResult = await db.query(
      `INSERT INTO support_ticket_attachments
         (ticket_id, ticket_type, user_id, media_url, media_type, file_name, file_size, created_at)
       VALUES ($1, 'customer', $2, $3, $4, $5, $6, CURRENT_TIMESTAMP) RETURNING *`,
      [
        id,
        userId,
        uploadResult.url,
        mediaType,
        file.originalname,
        uploadResult.size,
      ],
    );

    await db.query(
      `UPDATE customer_support_tickets SET attachment_count = attachment_count + 1 WHERE id = $1`,
      [id],
    );

    res.status(201).json({
      message: "Media uploaded successfully",
      attachment: attachmentResult.rows[0],
    });
  } catch (err) {
    console.error("Error uploading customer ticket media:", err);
    res.status(500).json({ error: "Failed to upload media" });
  }
}

// ─────────────────────────────────────────────────────────────────────
export async function deleteCustomerTicketMedia(req, res) {
  try {
    const { ticketId, attachmentId } = req.params;
    const { id: userId, role: userRole } = req.user;

    const attachmentResult = await db.query(
      `SELECT * FROM support_ticket_attachments WHERE id = $1 AND ticket_id = $2`,
      [attachmentId, ticketId],
    );
    if (!attachmentResult.rows.length)
      return res.status(404).json({ error: "Attachment not found" });
    if (userRole !== "admin" && attachmentResult.rows[0].user_id !== userId)
      return res.status(403).json({ error: "Unauthorized" });

    const { media_url, media_type } = attachmentResult.rows[0];
    const publicId = media_url.split("/").pop().split(".")[0];
    await deleteMediaFromCloudinary(publicId, media_type);
    await db.query(`DELETE FROM support_ticket_attachments WHERE id = $1`, [
      attachmentId,
    ]);
    await db.query(
      `UPDATE customer_support_tickets SET attachment_count = GREATEST(0, attachment_count - 1) WHERE id = $1`,
      [ticketId],
    );

    res.json({ message: "Media deleted successfully" });
  } catch (err) {
    console.error("Error deleting customer ticket media:", err);
    res.status(500).json({ error: "Failed to delete media" });
  }
}

// ─────────────────────────────────────────────────────────────────────
export async function deleteCustomerSupportTicket(req, res) {
  try {
    const { id } = req.params;
    const { id: userId, role: userRole } = req.user;

    const ticketResult = await db.query(
      `SELECT * FROM customer_support_tickets WHERE id = $1`,
      [id],
    );
    if (!ticketResult.rows.length)
      return res.status(404).json({ error: "Support ticket not found" });
    if (userRole !== "admin" && ticketResult.rows[0].user_id !== userId)
      return res.status(403).json({ error: "Unauthorized" });

    const attachmentsResult = await db.query(
      `SELECT * FROM support_ticket_attachments WHERE ticket_id = $1`,
      [id],
    );
    for (const att of attachmentsResult.rows) {
      const publicId = att.media_url.split("/").pop().split(".")[0];
      await deleteMediaFromCloudinary(publicId, att.media_type).catch(
        console.error,
      );
    }

    await db.query(
      `DELETE FROM customer_support_replies WHERE ticket_id = $1`,
      [id],
    );
    await db.query(
      `DELETE FROM support_ticket_attachments WHERE ticket_id = $1`,
      [id],
    );
    const result = await db.query(
      `DELETE FROM customer_support_tickets WHERE id = $1 RETURNING *`,
      [id],
    );

    res.json({
      message: "Support ticket deleted successfully",
      ticket: result.rows[0],
    });
  } catch (err) {
    console.error("Error deleting customer support ticket:", err);
    res.status(500).json({ error: "Failed to delete support ticket" });
  }
}

// ─────────────────────────────────────────────────────────────────────
export async function getCustomerSupportStats(req, res) {
  try {
    const statsResult = await db.query(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_count
       FROM customer_support_tickets`,
    );
    res.json(statsResult.rows[0]);
  } catch (err) {
    console.error("Error fetching customer support stats:", err);
    res.status(500).json({ error: "Failed to fetch support statistics" });
  }
}

export async function getCustomerSupportUnreadCount(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let result;
    if (userRole === "admin") {
      result = await db.query(
        `SELECT COUNT(*) AS unread FROM customer_support_tickets WHERE status = 'open'`,
      );
    } else {
      result = await db.query(
        `SELECT COUNT(*) AS unread FROM customer_support_tickets
         WHERE user_id = $1 AND status IN ('open', 'in_progress')`,
        [userId],
      );
    }

    res.json({ unread: parseInt(result.rows[0].unread, 10) });
  } catch (err) {
    console.error("Error fetching customer support unread count:", err);
    res.status(500).json({ error: "Failed to fetch unread count" });
  }
}
