import db from "../config/database.js";
import {
  uploadMediaToCloudinary,
  deleteMediaFromCloudinary,
  validateMediaFile,
} from "../utils/cloudinary-utils.js";

// ─── Get or create a support conversation between maid and admin ──────
export async function getOrCreateMaidSupportConversation(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole !== "maid" && userRole !== "admin") {
      return res
        .status(403)
        .json({ error: "Only maids can open maid support conversations" });
    }

    // Maids always open their own conversation.
    // Admins supply ?maidId=<uuid> to look up a specific maid's thread.
    let maidId;
    if (userRole === "admin") {
      maidId = req.query.maidId;
      if (!maidId) {
        return res
          .status(400)
          .json({ error: "maidId query param required for admin" });
      }
    } else {
      maidId = userId;
    }

    const requesterId = String(userId).toLowerCase().trim();
    const normalizedMaidId = String(maidId).toLowerCase().trim();

    // Maids can only open their own conversation
    if (userRole !== "admin" && requesterId !== normalizedMaidId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // ── Get or create the maid support conversation ──────────────────
    let convResult = await db.query(
      `SELECT * FROM maid_support_conversations WHERE maid_id = $1`,
      [normalizedMaidId],
    );

    let conversation;
    if (convResult.rows.length === 0) {
      const newConv = await db.query(
        `INSERT INTO maid_support_conversations
           (maid_id, unread_maid, unread_admin, created_at, updated_at)
         VALUES ($1, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING *`,
        [normalizedMaidId],
      );
      conversation = newConv.rows[0];
    } else {
      conversation = convResult.rows[0];

      // If maid previously deleted this conversation, re-open it
      if (userRole === "maid" && conversation.deleted_by_maid) {
        await db.query(
          `UPDATE maid_support_conversations
           SET deleted_by_maid = false, deleted_at_maid = NULL
           WHERE id = $1`,
          [conversation.id],
        );
        conversation = {
          ...conversation,
          deleted_by_maid: false,
          deleted_at_maid: null,
        };
      }
    }

    const isMaid = requesterId === normalizedMaidId;

    // ── Mark other party's messages as read FIRST ─────────────────────
    // Must happen before fetching messages so the returned rows have
    // is_read = true — this is what drives the ✓✓ tick on the frontend.
    await db.query(
      `UPDATE maid_support_messages
       SET is_read = true
       WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false`,
      [conversation.id, userId],
    );

    // Reset unread counter for current user
    await db.query(
      `UPDATE maid_support_conversations
       SET ${isMaid ? "unread_maid = 0" : "unread_admin = 0"}
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
       FROM maid_support_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversation.id],
    );

    res.json({ conversation, messages: messagesResult.rows });
  } catch (err) {
    console.error(
      "[maid-support-chat] getOrCreateMaidSupportConversation error:",
      err.message,
    );
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
}

// ─── Send a text message ─────────────────────────────────────────────
export async function sendMaidSupportMessage(req, res) {
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
      `SELECT * FROM maid_support_conversations WHERE id = $1`,
      [conversationId],
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const conversation = convResult.rows[0];
    const requesterId = String(userId).toLowerCase().trim();
    const maidId = String(conversation.maid_id).toLowerCase().trim();

    // Only the conversation's maid or any admin can send messages
    if (userRole !== "admin" && requesterId !== maidId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const messageResult = await db.query(
      `INSERT INTO maid_support_messages
         (conversation_id, sender_id, content, message_type, is_read, created_at)
       VALUES ($1, $2, $3, 'text', false, CURRENT_TIMESTAMP)
       RETURNING *`,
      [conversationId, userId, trimmedContent],
    );

    const message = messageResult.rows[0];

    // If sender is maid, increment unread_admin and vice versa
    const isMaid = requesterId === maidId;
    await db.query(
      `UPDATE maid_support_conversations
       SET updated_at = CURRENT_TIMESTAMP,
           unread_admin = CASE WHEN $1 THEN unread_admin + 1 ELSE unread_admin END,
           unread_maid  = CASE WHEN $1 THEN unread_maid      ELSE unread_maid  + 1 END
       WHERE id = $2`,
      [isMaid, conversationId],
    );

    const enriched = await db.query(
      `SELECT m.*, u.name AS sender_name, u.role AS sender_role
       FROM maid_support_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.id = $1`,
      [message.id],
    );

    res.status(201).json({ message: enriched.rows[0] });
  } catch (err) {
    console.error(
      "[maid-support-chat] sendMaidSupportMessage error:",
      err.message,
    );
    res.status(500).json({ error: "Failed to send message" });
  }
}

// ─── Send a media message ────────────────────────────────────────────
export async function sendMaidSupportMediaMessage(req, res) {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const convResult = await db.query(
      `SELECT * FROM maid_support_conversations WHERE id = $1`,
      [conversationId],
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const conversation = convResult.rows[0];
    const requesterId = String(userId).toLowerCase().trim();
    const maidId = String(conversation.maid_id).toLowerCase().trim();

    if (userRole !== "admin" && requesterId !== maidId) {
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
      `maid-support-chats/${conversationId}`,
    );

    const messageResult = await db.query(
      `INSERT INTO maid_support_messages
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

    const isMaid = requesterId === maidId;
    await db.query(
      `UPDATE maid_support_conversations
       SET updated_at = CURRENT_TIMESTAMP,
           unread_admin = CASE WHEN $1 THEN unread_admin + 1 ELSE unread_admin END,
           unread_maid  = CASE WHEN $1 THEN unread_maid      ELSE unread_maid  + 1 END
       WHERE id = $2`,
      [isMaid, conversationId],
    );

    const enriched = await db.query(
      `SELECT m.*, u.name AS sender_name, u.role AS sender_role
       FROM maid_support_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.id = $1`,
      [messageResult.rows[0].id],
    );

    res.status(201).json({ message: enriched.rows[0] });
  } catch (err) {
    console.error(
      "[maid-support-chat] sendMaidSupportMediaMessage error:",
      err.message,
    );
    res.status(500).json({ error: "Failed to send media message" });
  }
}

// ─── Mark messages as read ───────────────────────────────────────────
export async function markMaidSupportMessagesRead(req, res) {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const convResult = await db.query(
      `SELECT * FROM maid_support_conversations WHERE id = $1`,
      [conversationId],
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const conversation = convResult.rows[0];
    const requesterId = String(userId).toLowerCase().trim();
    const maidId = String(conversation.maid_id).toLowerCase().trim();

    await db.query(
      `UPDATE maid_support_messages
       SET is_read = true
       WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false`,
      [conversationId, userId],
    );

    const isMaid = requesterId === maidId;
    await db.query(
      `UPDATE maid_support_conversations
       SET ${isMaid ? "unread_maid = 0" : "unread_admin = 0"}
       WHERE id = $1`,
      [conversationId],
    );

    res.json({ success: true });
  } catch (err) {
    console.error(
      "[maid-support-chat] markMaidSupportMessagesRead error:",
      err.message,
    );
    res.status(500).json({ error: "Failed to mark messages as read" });
  }
}

// ─── Get all maid support conversations for the logged-in user ────────
export async function getMyMaidSupportConversations(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let query;
    let params;

    if (userRole === "admin") {
      query = `
        SELECT
          c.*,
          mu.name   AS maid_name,
          mu.email  AS maid_email,
          mu.avatar AS maid_avatar,
          (SELECT content    FROM maid_support_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
          (SELECT created_at FROM maid_support_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
        FROM maid_support_conversations c
        LEFT JOIN users mu ON mu.id = c.maid_id
        ORDER BY c.updated_at DESC
      `;
      params = [];
    } else {
      query = `
        SELECT
          c.*,
          mu.name   AS maid_name,
          mu.email  AS maid_email,
          mu.avatar AS maid_avatar,
          (SELECT content    FROM maid_support_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
          (SELECT created_at FROM maid_support_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
        FROM maid_support_conversations c
        LEFT JOIN users mu ON mu.id = c.maid_id
        WHERE c.maid_id = $1
          AND c.deleted_by_maid = false
        ORDER BY c.updated_at DESC
      `;
      params = [userId];
    }

    const result = await db.query(query, params);
    res.json({ conversations: result.rows });
  } catch (err) {
    console.error(
      "[maid-support-chat] getMyMaidSupportConversations error:",
      err.message,
    );
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
}

// ─── Get total unread maid support message count ─────────────────────
export async function getMaidSupportUnreadCount(req, res) {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let result;

    if (userRole === "admin") {
      result = await db.query(
        `SELECT COALESCE(SUM(unread_admin), 0) AS total_unread
         FROM maid_support_conversations`,
      );
    } else {
      result = await db.query(
        `SELECT COALESCE(unread_maid, 0) AS total_unread
         FROM maid_support_conversations
         WHERE maid_id = $1`,
        [userId],
      );
    }

    const total =
      result.rows.length > 0 ? parseInt(result.rows[0].total_unread, 10) : 0;

    res.json({ unread: total });
  } catch (err) {
    console.error(
      "[maid-support-chat] getMaidSupportUnreadCount error:",
      err.message,
    );
    res.status(500).json({ error: "Failed to fetch unread count" });
  }
}

// ─── Delete a message (sender only, within 5 mins) ───────────────────
export async function deleteMaidSupportMessage(req, res) {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const msgResult = await db.query(
      `SELECT * FROM maid_support_messages WHERE id = $1`,
      [messageId],
    );

    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    const msg = msgResult.rows[0];
    const normalizedSenderId = String(msg.sender_id).toLowerCase().trim();
    const normalizedUserId = String(userId).toLowerCase().trim();

    if (userRole !== "admin" && normalizedSenderId !== normalizedUserId) {
      return res.status(403).json({
        error: "Unauthorized",
        debug: { normalizedSenderId, normalizedUserId },
      });
    }

    if (userRole !== "admin") {
      const ageMinutes =
        (Date.now() - new Date(msg.created_at).getTime()) / 60000;
      if (ageMinutes > 5) {
        return res.status(403).json({
          error: "Messages can only be deleted within 5 minutes of sending",
        });
      }
    }

    try {
      await db.query(
        `UPDATE maid_support_messages
         SET deleted_at = CURRENT_TIMESTAMP,
             deleted_by = $2
         WHERE id = $1`,
        [messageId, userId],
      );
    } catch (updateErr) {
      if (
        updateErr.message?.includes("column") &&
        updateErr.message?.includes("deleted")
      ) {
        console.error(
          "[maid-support-chat] soft-delete columns missing — run migration",
        );
        await db.query(`DELETE FROM maid_support_messages WHERE id = $1`, [
          messageId,
        ]);
      } else {
        throw updateErr;
      }
    }

    res.json({ success: true, deleted: true });
  } catch (err) {
    console.error(
      "[maid-support-chat] deleteMaidSupportMessage error:",
      err.message,
    );
    res.status(500).json({ error: err.message });
  }
}

// ─── ADMIN: List all maid support conversations with pagination + search
export async function adminGetAllMaidSupportConversations(req, res) {
  try {
    const { page = 1, limit = 20, search = "" } = req.query;
    const offset = (page - 1) * limit;

    const searchClause = search.trim()
      ? `AND (mu.name ILIKE $3 OR mu.email ILIKE $3)`
      : "";
    const params = search.trim()
      ? [limit, offset, `%${search.trim()}%`]
      : [limit, offset];

    const result = await db.query(
      `SELECT
         c.id,
         c.maid_id,
         c.unread_maid,
         c.unread_admin,
         c.created_at,
         c.updated_at,
         c.deleted_by_maid,
         c.deleted_at_maid,
         CASE
           WHEN c.deleted_by_maid THEN 'deleted_by_maid'
           ELSE 'active'
         END AS deletion_status,
         mu.name   AS maid_name,
         mu.email  AS maid_email,
         mu.avatar AS maid_avatar,
         (SELECT COUNT(*) FROM maid_support_messages WHERE conversation_id = c.id)::int AS message_count,
         (SELECT content    FROM maid_support_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
         (SELECT created_at FROM maid_support_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
       FROM maid_support_conversations c
       JOIN users mu ON mu.id = c.maid_id
       WHERE 1=1 ${searchClause}
       ORDER BY c.updated_at DESC
       LIMIT $1 OFFSET $2`,
      params,
    );

    const countParams = search.trim() ? [`%${search.trim()}%`] : [];
    const countClause = search.trim()
      ? `JOIN users mu ON mu.id = c.maid_id WHERE (mu.name ILIKE $1 OR mu.email ILIKE $1)`
      : "";
    const countResult = await db.query(
      `SELECT COUNT(*) FROM maid_support_conversations c ${countClause}`,
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
      "[maid-support-chat] adminGetAllMaidSupportConversations error:",
      err.message,
    );
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
}

// ─── ADMIN: Read a single maid support conversation (view-only) ───────
export async function adminGetMaidSupportConversation(req, res) {
  try {
    const { conversationId } = req.params;

    const convResult = await db.query(
      `SELECT
         c.*,
         CASE
           WHEN c.deleted_by_maid THEN 'deleted_by_maid'
           ELSE 'active'
         END AS deletion_status,
         mu.id     AS maid_id,
         mu.name   AS maid_name,
         mu.email  AS maid_email,
         mu.avatar AS maid_avatar
       FROM maid_support_conversations c
       JOIN users mu ON mu.id = c.maid_id
       WHERE c.id = $1`,
      [conversationId],
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const messagesResult = await db.query(
      `SELECT
         m.*,
         u.name   AS sender_name,
         u.role   AS sender_role,
         u.avatar AS sender_avatar,
         du.name  AS deleted_by_name
       FROM maid_support_messages m
       JOIN users u       ON u.id  = m.sender_id
       LEFT JOIN users du ON du.id = m.deleted_by
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversationId],
    );

    res.json({
      conversation: convResult.rows[0],
      messages: messagesResult.rows,
      admin_view: true,
    });
  } catch (err) {
    console.error(
      "[maid-support-chat] adminGetMaidSupportConversation error:",
      err.message,
    );
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
}

// ─── Soft-delete a maid support conversation (maid only) ─────────────
export async function deleteMaidSupportConversation(req, res) {
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
      `SELECT * FROM maid_support_conversations WHERE id = $1`,
      [conversationId],
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const conv = convResult.rows[0];
    const requesterId = String(userId).toLowerCase().trim();
    const maidId = String(conv.maid_id).toLowerCase().trim();

    if (requesterId !== maidId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    await db.query(
      `UPDATE maid_support_conversations
       SET deleted_by_maid = true, deleted_at_maid = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [conversationId],
    );

    res.json({
      success: true,
      message: "Conversation removed from your inbox",
    });
  } catch (err) {
    console.error(
      "[maid-support-chat] deleteMaidSupportConversation error:",
      err.message,
    );
    res.status(500).json({ error: "Failed to delete conversation" });
  }
}
