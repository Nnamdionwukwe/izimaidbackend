import db from "../config/database.js";
import {
  uploadMediaToCloudinary,
  deleteMediaFromCloudinary,
  validateMediaFile,
} from "../utils/cloudinary-utils.js";

import { sendSupportChatMessageEmail } from "../utils/mailer.js";

// ─── Get or create a support conversation between customer and admin ──
export async function getOrCreateSupportConversation(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Only customers and admins can use support chat
    if (userRole !== "customer" && userRole !== "admin") {
      return res
        .status(403)
        .json({ error: "Only customers can open support conversations" });
    }

    // Customers always open their own conversation.
    // Admins supply ?customerId=<uuid> to look up a specific customer's thread.
    let customerId;
    if (userRole === "admin") {
      customerId = req.query.customerId;
      if (!customerId) {
        return res
          .status(400)
          .json({ error: "customerId query param required for admin" });
      }
    } else {
      customerId = userId;
    }

    const requesterId = String(userId).toLowerCase().trim();
    const normalizedCustomerId = String(customerId).toLowerCase().trim();

    // Auth check — customers can only open their own conversation
    if (userRole !== "admin" && requesterId !== normalizedCustomerId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // ── Get or create the support conversation ───────────────────────
    let convResult = await db.query(
      `SELECT * FROM support_conversations WHERE customer_id = $1`,
      [normalizedCustomerId],
    );

    let conversation;
    if (convResult.rows.length === 0) {
      const newConv = await db.query(
        `INSERT INTO support_conversations
           (customer_id, unread_customer, unread_admin, created_at, updated_at)
         VALUES ($1, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING *`,
        [normalizedCustomerId],
      );
      conversation = newConv.rows[0];
    } else {
      conversation = convResult.rows[0];

      // If customer previously deleted this conversation, re-open it
      if (userRole === "customer" && conversation.deleted_by_customer) {
        await db.query(
          `UPDATE support_conversations
           SET deleted_by_customer = false, deleted_at_customer = NULL
           WHERE id = $1`,
          [conversation.id],
        );
        conversation = {
          ...conversation,
          deleted_by_customer: false,
          deleted_at_customer: null,
        };
      }
    }

    const isCustomer = requesterId === normalizedCustomerId;

    // ── Mark other party's messages as read FIRST ─────────────────────
    // Must happen before fetching messages so the returned rows have
    // is_read = true — this is what drives the ✓✓ tick on the frontend.
    await db.query(
      `UPDATE support_messages
       SET is_read = true
       WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false`,
      [conversation.id, userId],
    );

    // Reset unread counter for current user
    await db.query(
      `UPDATE support_conversations
       SET ${isCustomer ? "unread_customer = 0" : "unread_admin = 0"}
       WHERE id = $1`,
      [conversation.id],
    );

    // ── Fetch messages AFTER marking read ─────────────────────────────
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
         CASE WHEN m.deleted_at IS NOT NULL THEN NULL      ELSE m.media_url  END AS media_url,
         CASE WHEN m.deleted_at IS NOT NULL THEN NULL      ELSE m.media_type END AS media_type,
         CASE WHEN m.deleted_at IS NOT NULL THEN 'deleted' ELSE m.content    END AS content,
         u.name   AS sender_name,
         u.role   AS sender_role,
         u.avatar AS sender_avatar
       FROM support_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversation.id],
    );

    res.json({ conversation, messages: messagesResult.rows });
  } catch (err) {
    console.error(
      "[support-chat] getOrCreateSupportConversation error:",
      err.message,
    );
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
}

// ─── Send a text message ─────────────────────────────────────────────
export async function sendSupportMessage(req, res) {
  try {
    const { conversationId } = req.params;
    const { content } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!content?.trim()) {
      return res.status(400).json({ error: "Message content is required" });
    }
    const trimmedContent = content.trim();

    const convResult = await db.query(
      `SELECT * FROM support_conversations WHERE id = $1`,
      [conversationId],
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const conversation = convResult.rows[0];
    const requesterId = String(userId).toLowerCase().trim();
    const customerId = String(conversation.customer_id).toLowerCase().trim();

    // Only the conversation's customer or any admin can send messages
    if (userRole !== "admin" && requesterId !== customerId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const messageResult = await db.query(
      `INSERT INTO support_messages
         (conversation_id, sender_id, content, message_type, is_read, created_at)
       VALUES ($1, $2, $3, 'text', false, CURRENT_TIMESTAMP)
       RETURNING *`,
      [conversationId, userId, trimmedContent],
    );

    const message = messageResult.rows[0];

    // Update unread counts — if sender is customer, increment unread_admin and vice versa
    const isCustomer = requesterId === customerId;
    await db.query(
      `UPDATE support_conversations
       SET updated_at = CURRENT_TIMESTAMP,
           unread_admin    = CASE WHEN $1 THEN unread_admin    + 1 ELSE unread_admin    END,
           unread_customer = CASE WHEN $1 THEN unread_customer     ELSE unread_customer + 1 END
       WHERE id = $2`,
      [isCustomer, conversationId],
    );

    const enrichedMsg = await db.query(
      `SELECT m.*, u.name AS sender_name, u.role AS sender_role
       FROM support_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.id = $1`,
      [message.id],
    );

    // ── Send email notification to the OTHER party ────────────────────
    // If customer sent → email all admins. If admin sent → email customer.
    (async () => {
      try {
        const senderName = enrichedMsg.rows[0].sender_name;
        const preview = trimmedContent.slice(0, 200);

        if (isCustomer) {
          // Notify admin(s)
          const { rows: admins } = await db.query(
            `SELECT name, email FROM users WHERE role = 'admin' AND is_active = true`,
          );
          for (const admin of admins) {
            sendSupportChatMessageEmail(admin, senderName, preview).catch(
              console.error,
            );
          }
        } else {
          // Notify customer
          const { rows: custRows } = await db.query(
            `SELECT name, email FROM users WHERE id = $1`,
            [conversation.customer_id],
          );
          if (custRows[0]) {
            sendSupportChatMessageEmail(custRows[0], senderName, preview).catch(
              console.error,
            );
          }
        }
      } catch (e) {
        console.error("[support-chat/email]", e);
      }
    })();

    res.status(201).json({ message: enrichedMsg.rows[0] });
  } catch (err) {
    console.error("[support-chat] sendSupportMessage error:", err.message);
    res.status(500).json({ error: "Failed to send message" });
  }
}

// ─── Send a media message ────────────────────────────────────────────
export async function sendSupportMediaMessage(req, res) {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const convResult = await db.query(
      `SELECT * FROM support_conversations WHERE id = $1`,
      [conversationId],
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const conversation = convResult.rows[0];
    const requesterId = String(userId).toLowerCase().trim();
    const customerId = String(conversation.customer_id).toLowerCase().trim();

    if (userRole !== "admin" && requesterId !== customerId) {
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
      `support-chats/${conversationId}`,
    );

    const messageResult = await db.query(
      `INSERT INTO support_messages
         (conversation_id, sender_id, content, media_url, media_type, message_type, is_read, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, false, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        conversationId,
        userId,
        file.originalname || null,
        uploadResult.url,
        mediaType,
        mediaType,
      ],
    );

    const isCustomer = requesterId === customerId;
    await db.query(
      `UPDATE support_conversations
       SET updated_at = CURRENT_TIMESTAMP,
           unread_admin    = CASE WHEN $1 THEN unread_admin    + 1 ELSE unread_admin    END,
           unread_customer = CASE WHEN $1 THEN unread_customer     ELSE unread_customer + 1 END
       WHERE id = $2`,
      [isCustomer, conversationId],
    );

    const enriched = await db.query(
      `SELECT m.*, u.name AS sender_name, u.role AS sender_role
       FROM support_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.id = $1`,
      [messageResult.rows[0].id],
    );

    (async () => {
      try {
        const senderName = enriched.rows[0].sender_name;
        const preview = `[${mediaType === "video" ? "Video" : "Image"} attachment]`;
        if (isCustomer) {
          const { rows: admins } = await db.query(
            `SELECT name, email FROM users WHERE role = 'admin' AND is_active = true`,
          );
          for (const admin of admins) {
            sendSupportChatMessageEmail(admin, senderName, preview).catch(
              console.error,
            );
          }
        } else {
          const { rows: custRows } = await db.query(
            `SELECT name, email FROM users WHERE id = $1`,
            [conversation.customer_id],
          );
          if (custRows[0]) {
            sendSupportChatMessageEmail(custRows[0], senderName, preview).catch(
              console.error,
            );
          }
        }
      } catch (e) {
        console.error("[support-chat/email/media]", e);
      }
    })();

    res.status(201).json({ message: enriched.rows[0] });
  } catch (err) {
    console.error("[support-chat] sendSupportMediaMessage error:", err.message);
    res.status(500).json({ error: "Failed to send media message" });
  }
}

// ─── Mark messages as read ───────────────────────────────────────────
export async function markSupportMessagesRead(req, res) {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const convResult = await db.query(
      `SELECT * FROM support_conversations WHERE id = $1`,
      [conversationId],
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const conversation = convResult.rows[0];
    const requesterId = String(userId).toLowerCase().trim();
    const customerId = String(conversation.customer_id).toLowerCase().trim();

    // Mark all messages from the other party as read
    await db.query(
      `UPDATE support_messages
       SET is_read = true
       WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false`,
      [conversationId, userId],
    );

    // Reset unread counter for current user
    const isCustomer = requesterId === customerId;
    await db.query(
      `UPDATE support_conversations
       SET ${isCustomer ? "unread_customer = 0" : "unread_admin = 0"}
       WHERE id = $1`,
      [conversationId],
    );

    res.json({ success: true });
  } catch (err) {
    console.error("[support-chat] markSupportMessagesRead error:", err.message);
    res.status(500).json({ error: "Failed to mark messages as read" });
  }
}

// ─── Get all support conversations for the logged-in user ────────────
export async function getMySupportConversations(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let query;
    let params;

    if (userRole === "admin") {
      // Admins see all support conversations
      query = `
        SELECT
          c.*,
          cu.name   AS customer_name,
          cu.email  AS customer_email,
          cu.avatar AS customer_avatar,
          (SELECT content    FROM support_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
          (SELECT created_at FROM support_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
        FROM support_conversations c
        LEFT JOIN users cu ON cu.id = c.customer_id
        ORDER BY c.updated_at DESC
      `;
      params = [];
    } else {
      // Customers see only their own, and only if not soft-deleted
      query = `
        SELECT
          c.*,
          cu.name   AS customer_name,
          cu.email  AS customer_email,
          cu.avatar AS customer_avatar,
          (SELECT content    FROM support_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
          (SELECT created_at FROM support_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
        FROM support_conversations c
        LEFT JOIN users cu ON cu.id = c.customer_id
        WHERE c.customer_id = $1
          AND c.deleted_by_customer = false
        ORDER BY c.updated_at DESC
      `;
      params = [userId];
    }

    const result = await db.query(query, params);
    res.json({ conversations: result.rows });
  } catch (err) {
    console.error(
      "[support-chat] getMySupportConversations error:",
      err.message,
    );
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
}

// ─── Get total unread support message count for a user ───────────────
export async function getSupportUnreadCount(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let result;

    if (userRole === "admin") {
      // Admin unread = sum of all unread_admin across all conversations
      result = await db.query(
        `SELECT COALESCE(SUM(unread_admin), 0) AS total_unread
         FROM support_conversations`,
      );
    } else {
      // Customer unread = their own unread_customer
      result = await db.query(
        `SELECT COALESCE(unread_customer, 0) AS total_unread
         FROM support_conversations
         WHERE customer_id = $1`,
        [userId],
      );
    }

    const total =
      result.rows.length > 0 ? parseInt(result.rows[0].total_unread, 10) : 0;

    res.json({ unread: total });
  } catch (err) {
    console.error("[support-chat] getSupportUnreadCount error:", err.message);
    res.status(500).json({ error: "Failed to fetch unread count" });
  }
}

// ─── Delete a message (sender only, within 5 mins) ───────────────────
export async function deleteSupportMessage(req, res) {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const msgResult = await db.query(
      `SELECT * FROM support_messages WHERE id = $1`,
      [messageId],
    );

    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    const msg = msgResult.rows[0];
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

    // Soft-delete — admin can still read content and media
    try {
      await db.query(
        `UPDATE support_messages
         SET deleted_at = CURRENT_TIMESTAMP,
             deleted_by = $2
         WHERE id = $1`,
        [messageId, userId],
      );
    } catch (updateErr) {
      // Fall back to hard-delete if soft-delete columns are missing
      if (
        updateErr.message?.includes("column") &&
        updateErr.message?.includes("deleted")
      ) {
        console.error(
          "[support-chat] soft-delete columns missing — run migration",
        );
        await db.query(`DELETE FROM support_messages WHERE id = $1`, [
          messageId,
        ]);
      } else {
        throw updateErr;
      }
    }

    res.json({ success: true, deleted: true });
  } catch (err) {
    console.error("[support-chat] deleteSupportMessage error:", err.message);
    res.status(500).json({ error: err.message });
  }
}

// ─── ADMIN: List all support conversations with pagination + search ───
export async function adminGetAllSupportConversations(req, res) {
  try {
    const { page = 1, limit = 20, search = "" } = req.query;
    const offset = (page - 1) * limit;

    const searchClause = search.trim()
      ? `AND (cu.name ILIKE $3 OR cu.email ILIKE $3)`
      : "";
    const params = search.trim()
      ? [limit, offset, `%${search.trim()}%`]
      : [limit, offset];

    const result = await db.query(
      `SELECT
         c.id,
         c.customer_id,
         c.unread_customer,
         c.unread_admin,
         c.created_at,
         c.updated_at,
         c.deleted_by_customer,
         c.deleted_at_customer,
         CASE
           WHEN c.deleted_by_customer THEN 'deleted_by_customer'
           ELSE 'active'
         END AS deletion_status,
         cu.id     AS customer_id,
         cu.name   AS customer_name,
         cu.email  AS customer_email,
         cu.avatar AS customer_avatar,
         (SELECT COUNT(*) FROM support_messages WHERE conversation_id = c.id)::int AS message_count,
         (SELECT content    FROM support_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
         (SELECT created_at FROM support_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
       FROM support_conversations c
       JOIN users cu ON cu.id = c.customer_id
       WHERE 1=1 ${searchClause}
       ORDER BY c.updated_at DESC
       LIMIT $1 OFFSET $2`,
      params,
    );

    const countParams = search.trim() ? [`%${search.trim()}%`] : [];
    const countClause = search.trim()
      ? `JOIN users cu ON cu.id = c.customer_id WHERE (cu.name ILIKE $1 OR cu.email ILIKE $1)`
      : "";
    const countResult = await db.query(
      `SELECT COUNT(*) FROM support_conversations c ${countClause}`,
      countParams,
    );

    const total = parseInt(countResult.rows[0].count, 10);

    res.json({
      conversations: result.rows,
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error(
      "[support-chat] adminGetAllSupportConversations error:",
      err.message,
    );
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
}

// ─── ADMIN: Read a single support conversation (view-only) ───────────
export async function adminGetSupportConversation(req, res) {
  try {
    const { conversationId } = req.params;

    const convResult = await db.query(
      `SELECT
         c.*,
         CASE
           WHEN c.deleted_by_customer THEN 'deleted_by_customer'
           ELSE 'active'
         END AS deletion_status,
         cu.id     AS customer_id,
         cu.name   AS customer_name,
         cu.email  AS customer_email,
         cu.avatar AS customer_avatar
       FROM support_conversations c
       JOIN users cu ON cu.id = c.customer_id
       WHERE c.id = $1`,
      [conversationId],
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Admin sees all messages including soft-deleted ones (with real content)
    const messagesResult = await db.query(
      `SELECT
         m.*,
         u.name   AS sender_name,
         u.role   AS sender_role,
         u.avatar AS sender_avatar,
         du.name  AS deleted_by_name
       FROM support_messages m
       JOIN users u       ON u.id  = m.sender_id
       LEFT JOIN users du ON du.id = m.deleted_by
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversationId],
    );

    // Admin viewing does NOT affect unread counters for the customer
    res.json({
      conversation: convResult.rows[0],
      messages: messagesResult.rows,
      admin_view: true,
    });
  } catch (err) {
    console.error(
      "[support-chat] adminGetSupportConversation error:",
      err.message,
    );
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
}

// ─── Soft-delete a support conversation (customer only) ──────────────
export async function deleteSupportConversation(req, res) {
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
      `SELECT * FROM support_conversations WHERE id = $1`,
      [conversationId],
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const conv = convResult.rows[0];
    const requesterId = String(userId).toLowerCase().trim();
    const customerId = String(conv.customer_id).toLowerCase().trim();

    if (requesterId !== customerId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    await db.query(
      `UPDATE support_conversations
       SET deleted_by_customer = true, deleted_at_customer = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [conversationId],
    );

    res.json({
      success: true,
      message: "Conversation removed from your inbox",
    });
  } catch (err) {
    console.error(
      "[support-chat] deleteSupportConversation error:",
      err.message,
    );
    res.status(500).json({ error: "Failed to delete conversation" });
  }
}
