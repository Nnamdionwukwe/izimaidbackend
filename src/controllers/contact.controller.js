// src/controllers/contact.controller.js
import ContactMessage from "../models/ContactMessage.js";

const VALID_SUBJECTS = [
  "General Enquiry",
  "Request a Quote",
  "Complaint",
  "Partnership",
  "Other",
];

const VALID_STATUSES = ["new", "read", "replied", "resolved", "archived"];

// ─────────────────────────────────────────────────────────────
// PUBLIC ROUTES (No authentication required)
// ─────────────────────────────────────────────────────────────

export const createContactMessage = async (req, res) => {
  const { name, email, phone, subject, message } = req.body;

  // ─── Validation ───────────────────────────────────────────
  const missing = [];
  if (!name) missing.push("name");
  if (!email) missing.push("email");
  if (!subject) missing.push("subject");
  if (!message) missing.push("message");

  if (missing.length) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields",
      fields: missing,
    });
  }

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      error: "Invalid email address",
    });
  }

  // Subject validation
  if (!VALID_SUBJECTS.includes(subject)) {
    return res.status(400).json({
      success: false,
      error: "Invalid subject selection",
    });
  }

  try {
    // Check for duplicate message (same email + similar message within 24 hours)
    const existingMessages = await ContactMessage.findByEmail(email);
    const recentMessage = existingMessages.find(
      (msg) =>
        msg.message === message &&
        new Date(msg.created_at) > new Date(Date.now() - 24 * 60 * 60 * 1000),
    );

    if (recentMessage) {
      return res.status(409).json({
        success: false,
        error: "A similar message was sent recently",
        existingReference: recentMessage.reference_number,
      });
    }

    // Create the contact message
    const contactMessage = await ContactMessage.create({
      fullName: name,
      email,
      phone: phone || null,
      subject,
      message,
    });

    console.log(
      `[contact] New message from ${email} (${contactMessage.reference_number})`,
    );

    // TODO: Send email notification to admin

    return res.status(201).json({
      success: true,
      message: "Message sent successfully",
      contact: {
        id: contactMessage.id,
        referenceNumber: contactMessage.reference_number,
        email: contactMessage.email,
        status: contactMessage.status,
        createdAt: contactMessage.created_at,
      },
    });
  } catch (error) {
    console.error("[contact.controller/createContactMessage]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error. Please try again later.",
    });
  }
};

// ─────────────────────────────────────────────────────────────
// ADMIN ROUTES (Authentication required)
// ─────────────────────────────────────────────────────────────

export const listMessages = async (req, res) => {
  const { status, subject, page = 1, limit = 50 } = req.query;

  try {
    const result = await ContactMessage.findAll({
      status,
      subject,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[contact.controller/listMessages]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const getMessage = async (req, res) => {
  const { id } = req.params;

  try {
    const message = await ContactMessage.findById(id);

    if (!message) {
      return res.status(404).json({
        success: false,
        error: "Message not found",
      });
    }

    return res.json({
      success: true,
      message,
    });
  } catch (error) {
    console.error("[contact.controller/getMessage]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

// src/controllers/contact.controller.js
export const updateMessageStatus = async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;

  if (!status) {
    return res.status(400).json({
      success: false,
      error: "Status is required",
    });
  }

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      success: false,
      error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
    });
  }

  try {
    // Ensure status is a string
    const statusStr = String(status);
    const notesStr = notes ? String(notes) : null;
    const userId = req.user?.id || null;

    const message = await ContactMessage.updateStatus(
      id,
      statusStr,
      notesStr,
      userId,
    );

    if (!message) {
      return res.status(404).json({
        success: false,
        error: "Message not found",
      });
    }

    return res.json({
      success: true,
      message: "Message status updated successfully",
      contact: message,
    });
  } catch (error) {
    console.error("[contact.controller/updateMessageStatus]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const updateAdminNotes = async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;

  try {
    const message = await ContactMessage.updateAdminNotes(id, notes);

    if (!message) {
      return res.status(404).json({
        success: false,
        error: "Message not found",
      });
    }

    return res.json({
      success: true,
      message: "Admin notes updated successfully",
      contact: message,
    });
  } catch (error) {
    console.error("[contact.controller/updateAdminNotes]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const deleteMessage = async (req, res) => {
  const { id } = req.params;

  try {
    const message = await ContactMessage.delete(id);

    if (!message) {
      return res.status(404).json({
        success: false,
        error: "Message not found",
      });
    }

    return res.json({
      success: true,
      message: "Message deleted successfully",
      contact: message,
    });
  } catch (error) {
    console.error("[contact.controller/deleteMessage]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const getMessageStats = async (req, res) => {
  try {
    const stats = await ContactMessage.getStats();
    const subjectStats = await ContactMessage.getSubjectStats();

    return res.json({
      success: true,
      stats,
      subjectStats,
    });
  } catch (error) {
    console.error("[contact.controller/getMessageStats]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const bulkUpdateStatus = async (req, res) => {
  const { messageIds, status, notes } = req.body;

  if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
    return res.status(400).json({
      success: false,
      error: "Message IDs array is required",
    });
  }

  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      success: false,
      error: `Valid status is required. Must be one of: ${VALID_STATUSES.join(", ")}`,
    });
  }

  try {
    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (const id of messageIds) {
      try {
        const message = await ContactMessage.updateStatus(
          id,
          status,
          notes,
          req.user?.id,
        );
        if (message) {
          successCount++;
          results.push({ id, success: true });
        } else {
          errorCount++;
          results.push({ id, success: false, error: "Message not found" });
        }
      } catch (err) {
        errorCount++;
        results.push({ id, success: false, error: err.message });
      }
    }

    return res.json({
      success: true,
      message: `Updated ${successCount} messages, ${errorCount} failed`,
      results,
      summary: { total: messageIds.length, successCount, errorCount },
    });
  } catch (error) {
    console.error("[contact.controller/bulkUpdateStatus]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};
