import db from "../config/database.js";

// Create a new customer support ticket
export async function createCustomerSupportTicket(req, res) {
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
      `INSERT INTO customer_support_tickets 
        (user_id, subject, message, category, priority, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [userId, subject, message, category, ticketPriority],
    );

    res.status(201).json({
      message: "Support ticket created successfully",
      ticket: result.rows[0],
    });
  } catch (err) {
    console.error("Error creating customer support ticket:", err);
    res.status(500).json({ error: "Failed to create support ticket" });
  }
}

// Get customer support tickets
export async function getCustomerSupportTickets(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { page = 1, limit = 10, status, category, sort = "desc" } = req.query;

    const offset = (page - 1) * limit;
    let query = `SELECT * FROM customer_support_tickets`;
    const params = [];

    // Users see only their tickets, admins see all
    if (userRole !== "admin") {
      query += ` WHERE user_id = $1`;
      params.push(userId);
    }

    // Filter by status if provided
    if (status) {
      if (userRole !== "admin") {
        query += ` AND status = $${params.length + 1}`;
      } else {
        query += ` WHERE status = $${params.length + 1}`;
      }
      params.push(status);
    }

    // Filter by category if provided
    if (category) {
      query += ` AND category = $${params.length + 1}`;
      params.push(category);
    }

    // Sort by created_at
    const sortOrder = sort === "asc" ? "ASC" : "DESC";
    query += ` ORDER BY created_at ${sortOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    // Get total count for pagination
    let countQuery = `SELECT COUNT(*) FROM customer_support_tickets`;
    const countParams = [];

    if (userRole !== "admin") {
      countQuery += ` WHERE user_id = $1`;
      countParams.push(userId);
    }

    if (status) {
      if (userRole !== "admin") {
        countQuery += ` AND status = $${countParams.length + 1}`;
      } else {
        countQuery += ` WHERE status = $${countParams.length + 1}`;
      }
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

// Get single customer support ticket with replies
export async function getCustomerSupportTicket(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Get ticket
    const ticketResult = await db.query(
      `SELECT * FROM customer_support_tickets WHERE id = $1`,
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
      `SELECT * FROM customer_support_replies WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [id],
    );

    res.json({
      ticket,
      replies: repliesResult.rows,
    });
  } catch (err) {
    console.error("Error fetching customer support ticket:", err);
    res.status(500).json({ error: "Failed to fetch support ticket" });
  }
}

// Update customer support ticket status (admin only)
export async function updateCustomerSupportTicket(req, res) {
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
      `UPDATE customer_support_tickets 
       SET status = $1, admin_notes = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [status, notes || null, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Support ticket not found" });
    }

    res.json({
      message: "Support ticket updated successfully",
      ticket: result.rows[0],
    });
  } catch (err) {
    console.error("Error updating customer support ticket:", err);
    res.status(500).json({ error: "Failed to update support ticket" });
  }
}

// Add reply to customer support ticket
export async function replyCustomerSupportTicket(req, res) {
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
      `SELECT * FROM customer_support_tickets WHERE id = $1`,
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
      `INSERT INTO customer_support_replies (ticket_id, user_id, message, created_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       RETURNING *`,
      [id, userId, message],
    );

    // Update ticket's updated_at timestamp
    await db.query(
      `UPDATE customer_support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id],
    );

    res.status(201).json({
      message: "Reply added successfully",
      reply: result.rows[0],
    });
  } catch (err) {
    console.error("Error adding customer support reply:", err);
    res.status(500).json({ error: "Failed to add reply" });
  }
}

// Delete customer support ticket
export async function deleteCustomerSupportTicket(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check if ticket exists
    const ticketResult = await db.query(
      `SELECT * FROM customer_support_tickets WHERE id = $1`,
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

    // Delete replies first (foreign key constraint)
    await db.query(
      `DELETE FROM customer_support_replies WHERE ticket_id = $1`,
      [id],
    );

    // Delete ticket
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

// Get customer support statistics (admin only)
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
