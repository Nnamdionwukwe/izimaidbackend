// ═══════════════════════════════════════════════════════════════════════════
// FILE 1: src/controllers/chat.controller.js
// ─── Add import at top (after existing imports) ───────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

import { notify } from "../utils/notify.js";

// ─── In sendMessage(), after the enriched query, REPLACE the fire-and-forget
// email block with this (keeps email + adds in-app for recipient) ──────────

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

// ─── In sendMediaMessage(), same replacement after enriched query ─────────

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

// ═══════════════════════════════════════════════════════════════════════════
// FILE 2: src/controllers/customer-admin-livechat.controller.js
//         (your support-chat controller — the one that was renamed)
// ─── Add import at top ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

import { notify, notifyAdmins } from "../utils/notify.js";

// ─── In sendSupportMessage(), REPLACE the fire-and-forget email block ─────

(async () => {
  try {
    const senderName = enrichedMsg.rows[0].sender_name;
    const preview = trimmedContent.slice(0, 200);

    if (isCustomer) {
      // Customer sent → notify all admins (in-app + email)
      await notifyAdmins(db, {
        type: "support_message",
        title: `New support message from ${senderName}`,
        body: preview.length > 80 ? preview.slice(0, 80) + "…" : preview,
        data: { conversation_id: conversationId },
        action_url: `/admin/support/chat`,
        sendMail: async () => {
          const { rows: admins } = await db.query(
            `SELECT name, email FROM users WHERE role = 'admin' AND is_active = true`,
          );
          for (const admin of admins) {
            await sendSupportChatMessageEmail(admin, senderName, preview);
          }
        },
      });
    } else {
      // Admin sent → notify customer (in-app + email)
      await notify(db, {
        userId: conversation.customer_id,
        type: "support_reply",
        title: `Support team replied`,
        body: preview.length > 80 ? preview.slice(0, 80) + "…" : preview,
        data: { conversation_id: conversationId },
        action_url: `/support/chat`,
        sendMail: async () => {
          const { rows: custRows } = await db.query(
            `SELECT name, email FROM users WHERE id = $1`,
            [conversation.customer_id],
          );
          if (custRows[0]) {
            await sendSupportChatMessageEmail(custRows[0], senderName, preview);
          }
        },
      });
    }
  } catch (e) {
    console.error("[support-chat/notify]", e);
  }
})();

// ─── In sendSupportMediaMessage(), same replacement ───────────────────────

(async () => {
  try {
    const senderName = enriched.rows[0].sender_name;
    const preview = `[${mediaType === "video" ? "Video" : "Image"} attachment]`;

    if (isCustomer) {
      await notifyAdmins(db, {
        type: "support_message",
        title: `New support message from ${senderName}`,
        body: preview,
        data: { conversation_id: conversationId },
        action_url: `/admin/support/chat`,
        sendMail: async () => {
          const { rows: admins } = await db.query(
            `SELECT name, email FROM users WHERE role = 'admin' AND is_active = true`,
          );
          for (const admin of admins) {
            await sendSupportChatMessageEmail(admin, senderName, preview);
          }
        },
      });
    } else {
      await notify(db, {
        userId: conversation.customer_id,
        type: "support_reply",
        title: `Support team replied`,
        body: preview,
        data: { conversation_id: conversationId },
        action_url: `/support/chat`,
        sendMail: async () => {
          const { rows: custRows } = await db.query(
            `SELECT name, email FROM users WHERE id = $1`,
            [conversation.customer_id],
          );
          if (custRows[0]) {
            await sendSupportChatMessageEmail(custRows[0], senderName, preview);
          }
        },
      });
    }
  } catch (e) {
    console.error("[support-chat/notify/media]", e);
  }
})();

// ═══════════════════════════════════════════════════════════════════════════
// FILE 3: src/controllers/maid-support-chat.controller.js
// ─── Add import at top ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

import { notify, notifyAdmins } from "../utils/notify.js";

// ─── In sendMaidSupportMessage(), REPLACE the fire-and-forget email block ──

(async () => {
  try {
    const senderName = enriched.rows[0].sender_name;
    const preview = trimmedContent.slice(0, 200);

    if (isMaid) {
      // Maid sent → notify all admins (in-app + email)
      await notifyAdmins(db, {
        type: "support_message",
        title: `New maid support message from ${senderName}`,
        body: preview.length > 80 ? preview.slice(0, 80) + "…" : preview,
        data: { conversation_id: conversationId },
        action_url: `/admin/maid-support/chat`,
        sendMail: async () => {
          const { rows: admins } = await db.query(
            `SELECT name, email FROM users WHERE role = 'admin' AND is_active = true`,
          );
          for (const admin of admins) {
            await sendMaidSupportChatMessageEmail(admin, senderName, preview);
          }
        },
      });
    } else {
      // Admin sent → notify the maid (in-app + email)
      await notify(db, {
        userId: conversation.maid_id,
        type: "support_reply",
        title: `Support team replied`,
        body: preview.length > 80 ? preview.slice(0, 80) + "…" : preview,
        data: { conversation_id: conversationId },
        action_url: `/maid/support/chat`,
        sendMail: async () => {
          const { rows: maidRows } = await db.query(
            `SELECT name, email FROM users WHERE id = $1`,
            [conversation.maid_id],
          );
          if (maidRows[0]) {
            await sendMaidSupportChatMessageEmail(
              maidRows[0],
              senderName,
              preview,
            );
          }
        },
      });
    }
  } catch (e) {
    console.error("[maid-support-chat/notify]", e);
  }
})();

// ─── In sendMaidSupportMediaMessage(), same replacement ──────────────────

(async () => {
  try {
    const senderName = enriched.rows[0].sender_name;
    const preview = `[${mediaType === "video" ? "Video" : "Image"} attachment]`;

    if (isMaid) {
      await notifyAdmins(db, {
        type: "support_message",
        title: `New maid support message from ${senderName}`,
        body: preview,
        data: { conversation_id: conversationId },
        action_url: `/admin/maid-support/chat`,
        sendMail: async () => {
          const { rows: admins } = await db.query(
            `SELECT name, email FROM users WHERE role = 'admin' AND is_active = true`,
          );
          for (const admin of admins) {
            await sendMaidSupportChatMessageEmail(admin, senderName, preview);
          }
        },
      });
    } else {
      await notify(db, {
        userId: conversation.maid_id,
        type: "support_reply",
        title: `Support team replied`,
        body: preview,
        data: { conversation_id: conversationId },
        action_url: `/maid/support/chat`,
        sendMail: async () => {
          const { rows: maidRows } = await db.query(
            `SELECT name, email FROM users WHERE id = $1`,
            [conversation.maid_id],
          );
          if (maidRows[0]) {
            await sendMaidSupportChatMessageEmail(
              maidRows[0],
              senderName,
              preview,
            );
          }
        },
      });
    }
  } catch (e) {
    console.error("[maid-support-chat/notify/media]", e);
  }
})();

// ═══════════════════════════════════════════════════════════════════════════
// FILE 4: src/controllers/maid-support.controller.js
// ─── Add imports at top (after existing imports) ──────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

import { sendEmail } from "../utils/mailer.js"; // already there but needed for the admin alert
import { notify, notifyAdmins } from "../utils/notify.js";

// ─── In createMaidSupportTicket(), REPLACE the fire-and-forget block ──────
// (the one that calls sendMaidTicketCreatedEmail)

await notify(db, {
  userId,
  type: "ticket_created",
  title: "Support ticket received 🎫",
  body: `Your ticket "${subject}" has been submitted. We'll respond within 24 hours.`,
  action_url: `/maid/support/tickets/${result.rows[0].id}`,
  sendMail: async () => {
    const { rows } = await db.query(
      `SELECT name, email FROM users WHERE id = $1`,
      [userId],
    );
    if (rows[0]) return sendMaidTicketCreatedEmail(rows[0], result.rows[0]);
  },
});

await notifyAdmins(db, {
  type: "ticket_created",
  title: `New maid support ticket 🎫`,
  body: `A maid opened a ticket: "${subject}" (${category})`,
  action_url: `/admin/maid-support/${result.rows[0].id}`,
  sendMail: async () => {
    const { rows: admins } = await db.query(
      `SELECT name, email FROM users WHERE role = 'admin' AND is_active = true`,
    );
    for (const admin of admins) {
      await sendEmail({
        to: admin.email,
        subject: `New maid support ticket — ${process.env.APP_NAME}`,
        html: `<p>New maid ticket. Subject: <strong>${subject}</strong>. Category: ${category}.</p>`,
      });
    }
  },
});

// ─── In updateMaidSupportTicket(), REPLACE the fire-and-forget block ─────
// (the one that calls sendMaidTicketStatusEmail)

if (["in_progress", "resolved", "closed"].includes(status)) {
  const statusLabels = {
    in_progress: "In Progress ⏳",
    resolved: "Resolved ✅",
    closed: "Closed 🔒",
  };

  await notify(db, {
    userId: result.rows[0].user_id,
    type: "ticket_status",
    title: `Ticket ${statusLabels[status]}`,
    body: `Your maid support ticket "${result.rows[0].subject}" is now ${status.replace("_", " ")}.`,
    action_url: `/maid/support/tickets/${result.rows[0].id}`,
    sendMail: async () => {
      const { rows } = await db.query(
        `SELECT name, email FROM users WHERE id = $1`,
        [result.rows[0].user_id],
      );
      if (rows[0])
        return sendMaidTicketStatusEmail(rows[0], result.rows[0], status);
    },
  });
}

// ─── In replyMaidSupportTicket(), REPLACE the fire-and-forget block ───────
// (the one that calls sendMaidTicketReplyEmail / sendEmail for admin alert)

const { rows: replierRowsFinal } = await db.query(
  `SELECT name FROM users WHERE id = $1`,
  [userId],
);
const replierName = replierRowsFinal[0]?.name || "Support Team";

if (userRole === "admin") {
  // Admin replied → notify maid (in-app + email)
  await notify(db, {
    userId: ticket.user_id,
    type: "ticket_reply",
    title: `New reply on your ticket 💬`,
    body: `${replierName} replied to your ticket "${ticket.subject}".`,
    action_url: `/maid/support/tickets/${ticket.id}`,
    sendMail: async () => {
      const { rows } = await db.query(
        `SELECT name, email FROM users WHERE id = $1`,
        [ticket.user_id],
      );
      if (rows[0])
        return sendMaidTicketReplyEmail(rows[0], ticket, message, replierName);
    },
  });
} else {
  // Maid replied → notify all admins (in-app + email)
  await notifyAdmins(db, {
    type: "ticket_reply",
    title: `Maid replied to ticket 💬`,
    body: `${replierName} replied to ticket "${ticket.subject}".`,
    action_url: `/admin/maid-support/${ticket.id}`,
    sendMail: async () => {
      const { rows: admins } = await db.query(
        `SELECT name, email FROM users WHERE role = 'admin' AND is_active = true`,
      );
      for (const admin of admins) {
        await sendEmail({
          to: admin.email,
          subject: `Maid replied to support ticket — ${process.env.APP_NAME}`,
          html: `<p><strong>${replierName}</strong> replied to ticket: <strong>${ticket.subject}</strong>.</p><p>${message}</p>`,
        });
      }
    },
  });
}
