import db from "../config/database.js";
import {
  uploadMediaToCloudinary,
  deleteMediaFromCloudinary,
  validateMediaFile,
} from "../utils/cloudinary-utils.js";

import { sendEmail, sendBookingChatMessageEmail } from "../utils/mailer.js";
import { notify } from "../utils/notify.js";

// ─── Get or create a conversation between customer and maid ──────────
export async function getOrCreateConversation(req, res) {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // ── Step 1: fetch the raw booking row first ──────────────────────
    const rawBooking = await db.query(`SELECT * FROM bookings WHERE id = $1`, [
      bookingId,
    ]);

    if (rawBooking.rows.length === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const raw = rawBooking.rows[0];

    // ── Step 2: both IDs are direct user IDs (confirmed from booking controller) ──
    // bookings.customer_id = users.id  (the customer)
    // bookings.maid_id     = users.id  (the maid's user account)
    // Normalize to lowercase strings to avoid UUID case/type mismatches
    const customerId = String(raw.customer_id).toLowerCase().trim();
    const maidUserId = String(raw.maid_id).toLowerCase().trim();
    const requesterId = String(userId).toLowerCase().trim();

    // ── Step 3: auth check ────────────────────────────────────────────
    if (
      userRole !== "admin" &&
      requesterId !== customerId &&
      requesterId !== maidUserId
    ) {
      // Surface debug info in development so you can diagnose mismatches
      console.error("[chat] 403 debug:", {
        requesterId,
        customerId,
        maidUserId,
        userRole,
        bookingId,
      });
      return res.status(403).json({
        error: "Unauthorized",
        debug: { requesterId, customerId, maidUserId },
      });
    }

    // ── Step 4: get or create conversation ───────────────────────────
    let convResult = await db.query(
      `SELECT * FROM conversations WHERE booking_id = $1`,
      [bookingId],
    );

    let conversation;
    if (convResult.rows.length === 0) {
      const newConv = await db.query(
        `INSERT INTO conversations
           (booking_id, customer_id, maid_id, created_at, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING *`,
        [bookingId, customerId, maidUserId],
      );
      conversation = newConv.rows[0];
    } else {
      conversation = convResult.rows[0];
      // If user previously deleted this conversation, re-open it for them
      const isCustomer = requesterId === customerId;
      if (
        (isCustomer && conversation.deleted_by_customer) ||
        (!isCustomer && conversation.deleted_by_maid)
      ) {
        const col = isCustomer ? "deleted_by_customer" : "deleted_by_maid";
        const atCol = isCustomer ? "deleted_at_customer" : "deleted_at_maid";
        await db.query(
          `UPDATE conversations SET ${col} = false, ${atCol} = NULL WHERE id = $1`,
          [conversation.id],
        );
        conversation = { ...conversation, [col]: false, [atCol]: null };
      }
    }

    // ── Step 5: fetch messages ────────────────────────────────────────
    const messagesResult = await db.query(
      `SELECT
         m.id,
         m.conversation_id,
         m.sender_id,
         m.message_type,
         m.is_read,
         m.created_at,
         m.deleted_at,
         m.deleted_by,
         -- Regular users see a placeholder for deleted messages
         CASE WHEN m.deleted_at IS NOT NULL THEN NULL      ELSE m.media_url   END AS media_url,
         CASE WHEN m.deleted_at IS NOT NULL THEN NULL      ELSE m.media_type  END AS media_type,
         CASE WHEN m.deleted_at IS NOT NULL THEN 'deleted' ELSE m.content     END AS content,
         u.name   AS sender_name,
         u.role   AS sender_role,
         u.avatar AS sender_avatar
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversation.id],
    );

    // ── Step 6: mark other party's messages as read ─────────────────
    const otherPartyId = requesterId === customerId ? maidUserId : customerId;
    await db.query(
      `UPDATE messages
       SET is_read = true
       WHERE conversation_id = $1 AND sender_id = $2 AND is_read = false`,
      [conversation.id, otherPartyId],
    );

    // Reset unread counter for current user
    const isCustomer = requesterId === customerId;
    await db.query(
      `UPDATE conversations
       SET ${isCustomer ? "unread_customer = 0" : "unread_maid = 0"}
       WHERE id = $1`,
      [conversation.id],
    );

    res.json({
      conversation,
      messages: messagesResult.rows,
    });
  } catch (err) {
    // Log the full error so it shows in your backend terminal
    console.error("[chat] getOrCreateConversation error:", err.message);
    console.error(err.stack);
    res.status(500).json({ error: err.message }); // surface real error in dev
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
    // Trim safely
    const trimmedContent = content.trim();

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
      [conversationId, userId, trimmedContent],
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

    (async () => {
      try {
        const senderName = enriched.rows[0].sender_name;
        const preview = trimmedContent.slice(0, 200);
        const isFromCustomer = userId === conversation.customer_id;
        const recipientId = isFromCustomer
          ? conversation.maid_id
          : conversation.customer_id;

        const { rows: recipientRows } = await db.query(
          `SELECT name, email FROM users WHERE id = $1`,
          [recipientId],
        );

        if (recipientRows[0]) {
          // ── In-app notification ──
          await notify(db, {
            userId: recipientId,
            type: "new_message",
            title: `New message from ${senderName}`,
            body: preview.length > 80 ? preview.slice(0, 80) + "…" : preview,
            data: { booking_id: conversation.booking_id },
            action_url: `/bookings/${conversation.booking_id}`,
            sendMail: () =>
              sendBookingChatMessageEmail(
                recipientRows[0],
                senderName,
                preview,
                conversation.booking_id,
              ),
          });
        }
      } catch (e) {
        console.error("[chat/notify]", e);
      }
    })();

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
        file.originalname || null, // caption/filename — nullable
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

    (async () => {
      try {
        const senderName = enriched.rows[0].sender_name;
        const preview = `[${mediaType === "video" ? "Video" : "Image"} attachment]`;
        const isFromCustomer = userId === conversation.customer_id;
        const recipientId = isFromCustomer
          ? conversation.maid_id
          : conversation.customer_id;

        const { rows: recipientRows } = await db.query(
          `SELECT name, email FROM users WHERE id = $1`,
          [recipientId],
        );

        if (recipientRows[0]) {
          await notify(db, {
            userId: recipientId,
            type: "new_message",
            title: `New message from ${senderName}`,
            body: preview,
            data: { booking_id: conversation.booking_id },
            action_url: `/bookings/${conversation.booking_id}`,
            sendMail: () =>
              sendBookingChatMessageEmail(
                recipientRows[0],
                senderName,
                preview,
                conversation.booking_id,
              ),
          });
        }
      } catch (e) {
        console.error("[chat/notify/media]", e);
      }
    })();

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
        WHERE (c.customer_id = $1 OR c.maid_id = $1)
          AND (
            (c.customer_id = $1 AND c.deleted_by_customer = false) OR
            (c.maid_id     = $1 AND c.deleted_by_maid     = false)
          )
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

    // Normalize UUIDs to avoid case/type mismatch (same fix as getOrCreateConversation)
    const normalizedSenderId = String(msg.sender_id).toLowerCase().trim();
    const normalizedUserId = String(userId).toLowerCase().trim();

    // Only sender or admin can delete
    if (userRole !== "admin" && normalizedSenderId !== normalizedUserId) {
      return res.status(403).json({
        error: "Unauthorized",
        debug: { normalizedSenderId, normalizedUserId },
      });
    }

    // Enforce 5-minute delete window for non-admins
    if (userRole !== "admin") {
      const ageMinutes =
        (Date.now() - new Date(msg.created_at).getTime()) / 60000;
      if (ageMinutes > 5) {
        return res.status(403).json({
          error: "Messages can only be deleted within 5 minutes of sending",
        });
      }
    }

    // Soft-delete only — content and media_url are preserved in DB
    // so admin can always read the original message and view media.
    // We do NOT delete from Cloudinary so admin can still open media files.

    try {
      // Soft-delete — requires deleted_at / deleted_by columns (run migration first)
      // Only mark as deleted — keep content/media_url intact so admin can still read them.
      // Regular users see a placeholder based on deleted_at; admin sees the real content.
      await db.query(
        `UPDATE messages
         SET deleted_at = CURRENT_TIMESTAMP,
             deleted_by = $2
         WHERE id = $1`,
        [messageId, userId],
      );
    } catch (updateErr) {
      // If the column doesn't exist yet, fall back to hard-delete so the
      // app doesn't break while the migration is pending.
      // Surface the real error so you know to run: node db/create-chat-tables.js
      if (
        updateErr.message?.includes("column") &&
        updateErr.message?.includes("deleted")
      ) {
        console.error(
          "[chat] soft-delete columns missing — run: node db/create-chat-tables.js",
        );
        console.error(
          "[chat] falling back to hard-delete for message:",
          messageId,
        );
        await db.query(`DELETE FROM messages WHERE id = $1`, [messageId]);
      } else {
        throw updateErr; // re-throw any other unexpected error
      }
    }

    res.json({ success: true, deleted: true });
  } catch (err) {
    console.error("[chat] deleteMessage error:", err.message);
    // Surface real error in response so you can debug without checking server logs
    res.status(500).json({ error: err.message });
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
         c.deleted_by_customer,
         c.deleted_by_maid,
         c.deleted_at_customer,
         c.deleted_at_maid,
         CASE
           WHEN c.deleted_by_customer AND c.deleted_by_maid THEN 'deleted_by_both'
           WHEN c.deleted_by_customer THEN 'deleted_by_customer'
           WHEN c.deleted_by_maid     THEN 'deleted_by_maid'
           ELSE 'active'
         END AS deletion_status,
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
         CASE
           WHEN c.deleted_by_customer AND c.deleted_by_maid THEN 'deleted_by_both'
           WHEN c.deleted_by_customer THEN 'deleted_by_customer'
           WHEN c.deleted_by_maid     THEN 'deleted_by_maid'
           ELSE 'active'
         END AS deletion_status,
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

    // Fetch all messages with sender info — admin sees everything including deleted
    const messagesResult = await db.query(
      `SELECT
         m.*,
         u.name    AS sender_name,
         u.role    AS sender_role,
         u.avatar  AS sender_avatar,
         du.name   AS deleted_by_name
       FROM messages m
       JOIN users u            ON u.id  = m.sender_id
       LEFT JOIN users du      ON du.id = m.deleted_by
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

// ─── Soft-delete a conversation for one party ────────────────────────
// Customer and maid can each "delete" their view independently.
// Admin always sees everything — their view is never affected.
export async function deleteConversation(req, res) {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole === "admin") {
      return res
        .status(403)
        .json({ error: "Admins cannot delete conversations" });
    }

    const convResult = await db.query(
      `SELECT * FROM conversations WHERE id = $1`,
      [conversationId],
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const conv = convResult.rows[0];
    const requesterId = String(userId).toLowerCase().trim();
    const customerId = String(conv.customer_id).toLowerCase().trim();
    const maidId = String(conv.maid_id).toLowerCase().trim();

    const isCustomer = requesterId === customerId;
    const isMaid = requesterId === maidId;

    if (!isCustomer && !isMaid) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const col = isCustomer ? "deleted_by_customer" : "deleted_by_maid";
    const atCol = isCustomer ? "deleted_at_customer" : "deleted_at_maid";

    await db.query(
      `UPDATE conversations
       SET ${col} = true, ${atCol} = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [conversationId],
    );

    res.json({
      success: true,
      message: "Conversation removed from your inbox",
    });
  } catch (err) {
    console.error("[chat] deleteConversation error:", err.message);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
}

// Add this new export to src/controllers/chat.controller.js

export async function getOrCreateInquiry(req, res) {
  try {
    const customerId = req.user.id;
    const { maidId } = req.params;

    // Verify maid exists
    const { rows: maidRows } = await db.query(
      `SELECT u.id, u.name FROM users u WHERE u.id = $1 AND u.role = 'maid' AND u.is_active = true`,
      [maidId],
    );
    if (!maidRows.length) {
      return res.status(404).json({ error: "Maid not found" });
    }

    // Get or create inquiry conversation
    let { rows } = await db.query(
      `SELECT * FROM conversations
       WHERE customer_id = $1 AND maid_id = $2 AND type = 'inquiry'
       LIMIT 1`,
      [customerId, maidId],
    );

    if (!rows.length) {
      const ins = await db.query(
        `INSERT INTO conversations
           (customer_id, maid_id, type, created_at, updated_at)
         VALUES ($1, $2, 'inquiry', now(), now())
         RETURNING *`,
        [customerId, maidId],
      );
      rows = ins.rows;
    }

    const conversation = rows[0];

    // Fetch messages
    const { rows: messages } = await db.query(
      `SELECT m.*,
              u.name   AS sender_name,
              u.role   AS sender_role,
              u.avatar AS sender_avatar,
              CASE WHEN m.deleted_at IS NOT NULL THEN 'deleted' ELSE m.content END AS content,
              CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE m.media_url END AS media_url
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversation.id],
    );

    // Mark read
    await db.query(
      `UPDATE messages SET is_read = true
       WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false`,
      [conversation.id, customerId],
    );

    const isCustomer = customerId === conversation.customer_id;
    await db.query(
      `UPDATE conversations
       SET ${isCustomer ? "unread_customer = 0" : "unread_maid = 0"}
       WHERE id = $1`,
      [conversation.id],
    );

    return res.json({
      conversation: { ...conversation, maid_name: maidRows[0].name },
      messages,
    });
  } catch (err) {
    console.error("[chat/getOrCreateInquiry]", err);
    return res.status(500).json({ error: err.message });
  }
}

export async function getMaidInquiry(req, res) {
  try {
    const maidId = req.user.id;
    const { customerId } = req.params;

    // Verify customer exists
    const { rows: customerRows } = await db.query(
      `SELECT id, name, avatar FROM users WHERE id = $1 AND role = 'customer'`,
      [customerId],
    );
    if (!customerRows.length) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Maids can only READ existing inquiry conversations — customer must initiate
    const { rows } = await db.query(
      `SELECT * FROM conversations
       WHERE customer_id = $1 AND maid_id = $2 AND type = 'inquiry'
       LIMIT 1`,
      [customerId, maidId],
    );

    if (!rows.length) {
      return res.status(404).json({ error: "No inquiry conversation found" });
    }

    const conversation = rows[0];

    // Fetch messages
    const { rows: messages } = await db.query(
      `SELECT m.*,
              u.name   AS sender_name,
              u.role   AS sender_role,
              u.avatar AS sender_avatar,
              CASE WHEN m.deleted_at IS NOT NULL THEN 'deleted' ELSE m.content END AS content,
              CASE WHEN m.deleted_at IS NOT NULL THEN NULL    ELSE m.media_url END AS media_url
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversation.id],
    );

    // Mark incoming messages as read for the maid
    await db.query(
      `UPDATE messages
       SET is_read = true
       WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false`,
      [conversation.id, maidId],
    );

    await db.query(`UPDATE conversations SET unread_maid = 0 WHERE id = $1`, [
      conversation.id,
    ]);

    return res.json({
      conversation: {
        ...conversation,
        customer_name: customerRows[0].name,
        customer_avatar: customerRows[0].avatar,
      },
      messages,
    });
  } catch (err) {
    console.error("[chat/getMaidInquiry]", err);
    return res.status(500).json({ error: err.message });
  }
}
