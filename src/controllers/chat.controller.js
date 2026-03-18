import db from "../config/database.js";
import {
  uploadMediaToCloudinary,
  deleteMediaFromCloudinary,
  validateMediaFile,
} from "../utils/cloudinary-utils.js";

// ─── Get or create a conversation between customer and maid ──────────
// A conversation is always tied to a booking so context is clear.
export async function getOrCreateConversation(req, res) {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Fetch the booking to get both participants.
    // maid_id in bookings may point to maid_profiles.id, so we join to get the user_id.
    // If that join fails (no maid_profiles row), we fall back to treating maid_id as a user_id directly.
    const bookingResult = await db.query(
      `SELECT
         b.id,
         b.user_id AS customer_id,
         COALESCE(mp.user_id, b.maid_id) AS maid_id
       FROM bookings b
       LEFT JOIN maid_profiles mp ON mp.id = b.maid_id
       WHERE b.id = $1`,
      [bookingId],
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const booking = bookingResult.rows[0];

    // Only the customer, maid, or admin can access this conversation
    if (
      userRole !== "admin" &&
      userId !== booking.customer_id &&
      userId !== booking.maid_id
    ) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Check if conversation already exists
    let convResult = await db.query(
      `SELECT * FROM conversations WHERE booking_id = $1`,
      [bookingId],
    );

    let conversation;
    if (convResult.rows.length === 0) {
      // Create new conversation
      const newConv = await db.query(
        `INSERT INTO conversations (booking_id, customer_id, maid_id, created_at, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING *`,
        [bookingId, booking.customer_id, booking.maid_id],
      );
      conversation = newConv.rows[0];
    } else {
      conversation = convResult.rows[0];
    }

    // Fetch messages
    const messagesResult = await db.query(
      `SELECT m.*, u.name AS sender_name, u.role AS sender_role
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversation.id],
    );

    // Mark all messages from the other party as read
    const otherPartyId =
      userId === booking.customer_id ? booking.maid_id : booking.customer_id;

    await db.query(
      `UPDATE messages
       SET is_read = true
       WHERE conversation_id = $1 AND sender_id = $2 AND is_read = false`,
      [conversation.id, otherPartyId],
    );

    res.json({
      conversation,
      messages: messagesResult.rows,
    });
  } catch (err) {
    console.error("Error getting/creating conversation:", err);
    res.status(500).json({ error: "Failed to get conversation" });
  }
}

// ─── Send a message ──────────────────────────────────────────────────
export async function sendMessage(req, res) {
  try {
    const { conversationId } = req.params;
    const { content } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!content?.trim()) {
      return res.status(400).json({ error: "Message content is required" });
    }

    // Verify the conversation exists and user is a participant
    const convResult = await db.query(
      `SELECT * FROM conversations WHERE id = $1`,
      [conversationId],
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const conversation = convResult.rows[0];

    if (
      userRole !== "admin" &&
      userId !== conversation.customer_id &&
      userId !== conversation.maid_id
    ) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Insert message
    const messageResult = await db.query(
      `INSERT INTO messages
         (conversation_id, sender_id, content, message_type, is_read, created_at)
       VALUES ($1, $2, $3, 'text', false, CURRENT_TIMESTAMP)
       RETURNING *`,
      [conversationId, userId, content.trim()],
    );

    const message = messageResult.rows[0];

    // Update conversation updated_at and unread count for recipient
    await db.query(
      `UPDATE conversations
       SET updated_at = CURRENT_TIMESTAMP,
           unread_customer = CASE WHEN $1 = maid_id THEN unread_customer + 1 ELSE unread_customer END,
           unread_maid     = CASE WHEN $1 = customer_id THEN unread_maid + 1 ELSE unread_maid END
       WHERE id = $2`,
      [userId, conversationId],
    );

    // Return message with sender info
    const enriched = await db.query(
      `SELECT m.*, u.name AS sender_name, u.role AS sender_role
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.id = $1`,
      [message.id],
    );

    res.status(201).json({ message: enriched.rows[0] });
  } catch (err) {
    console.error("Error sending message:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
}

// ─── Upload media in a conversation ─────────────────────────────────
export async function sendMediaMessage(req, res) {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const convResult = await db.query(
      `SELECT * FROM conversations WHERE id = $1`,
      [conversationId],
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const conversation = convResult.rows[0];

    if (
      userRole !== "admin" &&
      userId !== conversation.customer_id &&
      userId !== conversation.maid_id
    ) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const isVideo = file.mimetype.startsWith("video/");
    const mediaType = isVideo ? "video" : "image";

    const validation = validateMediaFile(file, mediaType);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const uploadResult = await uploadMediaToCloudinary(
      file.buffer,
      mediaType,
      `chats/${conversationId}`,
    );

    const messageResult = await db.query(
      `INSERT INTO messages
         (conversation_id, sender_id, content, media_url, media_type, message_type, is_read, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, false, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        conversationId,
        userId,
        file.originalname,
        uploadResult.url,
        mediaType,
        mediaType, // message_type = 'image' or 'video'
      ],
    );

    // Update unread counts
    await db.query(
      `UPDATE conversations
       SET updated_at = CURRENT_TIMESTAMP,
           unread_customer = CASE WHEN $1 = maid_id THEN unread_customer + 1 ELSE unread_customer END,
           unread_maid     = CASE WHEN $1 = customer_id THEN unread_maid + 1 ELSE unread_maid END
       WHERE id = $2`,
      [userId, conversationId],
    );

    const enriched = await db.query(
      `SELECT m.*, u.name AS sender_name, u.role AS sender_role
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.id = $1`,
      [messageResult.rows[0].id],
    );

    res.status(201).json({ message: enriched.rows[0] });
  } catch (err) {
    console.error("Error sending media message:", err);
    res.status(500).json({ error: "Failed to send media message" });
  }
}

// ─── Mark messages as read ───────────────────────────────────────────
export async function markMessagesRead(req, res) {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    const convResult = await db.query(
      `SELECT * FROM conversations WHERE id = $1`,
      [conversationId],
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const conversation = convResult.rows[0];

    // Mark messages from the other party as read
    await db.query(
      `UPDATE messages
       SET is_read = true
       WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false`,
      [conversationId, userId],
    );

    // Reset the unread counter for the current user
    const isCustomer = userId === conversation.customer_id;
    await db.query(
      `UPDATE conversations
       SET ${isCustomer ? "unread_customer = 0" : "unread_maid = 0"}
       WHERE id = $1`,
      [conversationId],
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Error marking messages as read:", err);
    res.status(500).json({ error: "Failed to mark messages as read" });
  }
}

// ─── Get all conversations for a user (inbox) ────────────────────────
export async function getMyConversations(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let query;
    let params;

    if (userRole === "admin") {
      // Admins see all conversations
      query = `
        SELECT
          c.*,
          b.service_date,
          b.status  AS booking_status,
          cu.name   AS customer_name,
          cu.avatar AS customer_avatar,
          mu.name   AS maid_name,
          mu.avatar AS maid_avatar,
          (SELECT content    FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
          (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
        FROM conversations c
        LEFT JOIN bookings b ON b.id = c.booking_id
        LEFT JOIN users cu   ON cu.id = c.customer_id
        LEFT JOIN users mu   ON mu.id = c.maid_id
        ORDER BY c.updated_at DESC
      `;
      params = [];
    } else {
      // Users and maids see only their own
      query = `
        SELECT
          c.*,
          b.service_date,
          b.status  AS booking_status,
          cu.name   AS customer_name,
          cu.avatar AS customer_avatar,
          mu.name   AS maid_name,
          mu.avatar AS maid_avatar,
          (SELECT content    FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
          (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
        FROM conversations c
        LEFT JOIN bookings b ON b.id = c.booking_id
        LEFT JOIN users cu   ON cu.id = c.customer_id
        LEFT JOIN users mu   ON mu.id = c.maid_id
        WHERE c.customer_id = $1 OR c.maid_id = $1
        ORDER BY c.updated_at DESC
      `;
      params = [userId];
    }

    const result = await db.query(query, params);
    res.json({ conversations: result.rows });
  } catch (err) {
    console.error("Error fetching conversations:", err);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
}

// ─── Get total unread count for a user ───────────────────────────────
export async function getUnreadCount(req, res) {
  try {
    const userId = req.user.id;

    const result = await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN customer_id = $1 THEN unread_customer ELSE 0 END), 0) +
         COALESCE(SUM(CASE WHEN maid_id     = $1 THEN unread_maid     ELSE 0 END), 0) AS total_unread
       FROM conversations
       WHERE customer_id = $1 OR maid_id = $1`,
      [userId],
    );

    res.json({ unread: parseInt(result.rows[0].total_unread, 10) });
  } catch (err) {
    console.error("Error fetching unread count:", err);
    res.status(500).json({ error: "Failed to fetch unread count" });
  }
}

// ─── Delete a message (sender only, within 5 mins) ──────────────────
export async function deleteMessage(req, res) {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const msgResult = await db.query(`SELECT * FROM messages WHERE id = $1`, [
      messageId,
    ]);

    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    const msg = msgResult.rows[0];

    // Only sender or admin can delete
    if (userRole !== "admin" && msg.sender_id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Enforce 5-minute delete window for non-admins
    if (userRole !== "admin") {
      const ageMinutes =
        (Date.now() - new Date(msg.created_at).getTime()) / 60000;
      if (ageMinutes > 5) {
        return res
          .status(403)
          .json({
            error: "Messages can only be deleted within 5 minutes of sending",
          });
      }
    }

    // Delete media from Cloudinary if present
    if (msg.media_url) {
      try {
        const publicId = msg.media_url.split("/").pop().split(".")[0];
        await deleteMediaFromCloudinary(publicId, msg.media_type);
      } catch (e) {
        console.error("Cloudinary delete error:", e);
      }
    }

    await db.query(`DELETE FROM messages WHERE id = $1`, [messageId]);

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting message:", err);
    res.status(500).json({ error: "Failed to delete message" });
  }
}

// ─── ADMIN ONLY: List all conversations (read-only view) ─────────────
export async function adminGetAllConversations(req, res) {
  try {
    const { page = 1, limit = 20, search = "" } = req.query;
    const offset = (page - 1) * limit;

    const searchClause = search.trim()
      ? `AND (cu.name ILIKE $3 OR mu.name ILIKE $3 OR b.id::text ILIKE $3)`
      : "";
    const params = search.trim()
      ? [limit, offset, `%${search.trim()}%`]
      : [limit, offset];

    const result = await db.query(
      `SELECT
         c.id,
         c.booking_id,
         c.created_at,
         c.updated_at,
         b.service_date,
         b.status          AS booking_status,
         cu.id             AS customer_id,
         cu.name           AS customer_name,
         cu.avatar         AS customer_avatar,
         mu.id             AS maid_id,
         mu.name           AS maid_name,
         mu.avatar         AS maid_avatar,
         (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id)::int
                           AS message_count,
         (SELECT content   FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1)
                           AS last_message,
         (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1)
                           AS last_message_at
       FROM conversations c
       JOIN bookings b ON b.id = c.booking_id
       JOIN users cu   ON cu.id = c.customer_id
       JOIN users mu   ON mu.id = c.maid_id
       ${searchClause}
       ORDER BY c.updated_at DESC
       LIMIT $1 OFFSET $2`,
      params,
    );

    // Total count for pagination
    const countParams = search.trim() ? [`%${search.trim()}%`] : [];
    const countClause = search.trim()
      ? `JOIN users cu ON cu.id = c.customer_id JOIN users mu ON mu.id = c.maid_id WHERE (cu.name ILIKE $1 OR mu.name ILIKE $1)`
      : "";
    const countResult = await db.query(
      `SELECT COUNT(*) FROM conversations c ${countClause}`,
      countParams,
    );

    res.json({
      conversations: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(parseInt(countResult.rows[0].count, 10) / limit),
    });
  } catch (err) {
    console.error("Error fetching all conversations (admin):", err);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
}

// ─── ADMIN ONLY: Read a single conversation's messages (view-only) ───
export async function adminGetConversation(req, res) {
  try {
    const { conversationId } = req.params;

    // Fetch conversation with participant details
    const convResult = await db.query(
      `SELECT
         c.*,
         b.service_date,
         b.status          AS booking_status,
         b.address,
         b.duration_hours,
         b.total_amount,
         cu.id             AS customer_id,
         cu.name           AS customer_name,
         cu.email          AS customer_email,
         cu.avatar         AS customer_avatar,
         mu.id             AS maid_id,
         mu.name           AS maid_name,
         mu.email          AS maid_email,
         mu.avatar         AS maid_avatar
       FROM conversations c
       JOIN bookings b ON b.id = c.booking_id
       JOIN users cu   ON cu.id = c.customer_id
       JOIN users mu   ON mu.id = c.maid_id
       WHERE c.id = $1`,
      [conversationId],
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Fetch all messages with sender info — admin sees everything
    const messagesResult = await db.query(
      `SELECT
         m.*,
         u.name   AS sender_name,
         u.role   AS sender_role,
         u.avatar AS sender_avatar
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversationId],
    );

    // NOTE: Admin viewing does NOT mark messages as read and does NOT
    // affect unread counters for the customer or maid.

    res.json({
      conversation: convResult.rows[0],
      messages: messagesResult.rows,
      // Remind callers this is a read-only admin view
      admin_view: true,
    });
  } catch (err) {
    console.error("Error fetching conversation (admin):", err);
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
}
