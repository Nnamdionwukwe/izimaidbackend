// src/controllers/shelter.controller.js
import ShelterApplication from "../models/ShelterApplication.js";

// Validation options
const VALID_CITIES = ["Abuja", "Lagos"];
const VALID_SUPPORT_TYPES = [
  "Shelter cleaning support",
  "Youth / children's home cleaning",
  "Elderly care facility cleaning",
  "Employment placement referral",
  "Transitional housing clean",
  "Individual family referral",
  "General partnership enquiry",
];
const VALID_STATUSES = [
  "pending",
  "reviewed",
  "approved",
  "rejected",
  "active",
];

// ─────────────────────────────────────────────────────────────
// PUBLIC ROUTES (No authentication required)
// ─────────────────────────────────────────────────────────────

export const createApplication = async (req, res) => {
  const {
    orgName,
    contactName,
    email,
    phone,
    city,
    orgType,
    supportType,
    residents,
    message,
  } = req.body;

  // ─── Validation ───────────────────────────────────────────
  const missing = [];
  if (!orgName) missing.push("orgName");
  if (!contactName) missing.push("contactName");
  if (!email) missing.push("email");
  if (!phone) missing.push("phone");
  if (!city) missing.push("city");
  if (!supportType) missing.push("supportType");
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

  // City validation
  if (!VALID_CITIES.includes(city)) {
    return res.status(400).json({
      success: false,
      error: "Invalid city selection",
    });
  }

  // Support type validation
  if (!VALID_SUPPORT_TYPES.includes(supportType)) {
    return res.status(400).json({
      success: false,
      error: "Invalid support type selection",
    });
  }

  try {
    // Check for duplicate application (same email within last 30 days)
    const existingApplications = await ShelterApplication.findByEmail(email);
    const recentApplication = existingApplications.find(
      (app) =>
        new Date(app.created_at) >
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    );

    if (recentApplication) {
      return res.status(409).json({
        success: false,
        error: "An application from this email was submitted recently",
        existingReference: recentApplication.reference_number,
      });
    }

    // Create the application
    const application = await ShelterApplication.create({
      organisationName: orgName,
      contactName,
      email,
      phone,
      city,
      organisationType: orgType || null,
      supportType,
      residentCount: residents || null,
      message,
    });

    console.log(
      `[shelter] New application from ${email} (${application.reference_number})`,
    );

    return res.status(201).json({
      success: true,
      message: "Application submitted successfully",
      application: {
        id: application.id,
        referenceNumber: application.reference_number,
        organisationName: application.organisation_name,
        contactName: application.contact_name,
        email: application.email,
        status: application.status,
        applicationDate: application.application_date || application.created_at,
      },
    });
  } catch (error) {
    console.error("[shelter.controller/createApplication]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error. Please try again later.",
    });
  }
};

// ─────────────────────────────────────────────────────────────
// ADMIN ROUTES (Authentication required)
// ─────────────────────────────────────────────────────────────

export const listApplications = async (req, res) => {
  const { status, city, supportType, page = 1, limit = 50 } = req.query;

  try {
    const result = await ShelterApplication.findAll({
      status,
      city,
      supportType,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[shelter.controller/listApplications]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const getApplication = async (req, res) => {
  const { id } = req.params;

  try {
    const application = await ShelterApplication.findById(id);

    if (!application) {
      return res.status(404).json({
        success: false,
        error: "Application not found",
      });
    }

    return res.json({
      success: true,
      application,
    });
  } catch (error) {
    console.error("[shelter.controller/getApplication]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const updateApplicationStatus = async (req, res) => {
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
    const application = await ShelterApplication.updateStatus(
      id,
      status,
      notes,
      req.user?.id,
    );

    if (!application) {
      return res.status(404).json({
        success: false,
        error: "Application not found",
      });
    }

    return res.json({
      success: true,
      message: "Application status updated successfully",
      application,
    });
  } catch (error) {
    console.error("[shelter.controller/updateApplicationStatus]", error);
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
    const application = await ShelterApplication.updateAdminNotes(id, notes);

    if (!application) {
      return res.status(404).json({
        success: false,
        error: "Application not found",
      });
    }

    return res.json({
      success: true,
      message: "Admin notes updated successfully",
      application,
    });
  } catch (error) {
    console.error("[shelter.controller/updateAdminNotes]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const deleteApplication = async (req, res) => {
  const { id } = req.params;

  try {
    const application = await ShelterApplication.delete(id);

    if (!application) {
      return res.status(404).json({
        success: false,
        error: "Application not found",
      });
    }

    return res.json({
      success: true,
      message: "Application deleted successfully",
      application,
    });
  } catch (error) {
    console.error("[shelter.controller/deleteApplication]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const getApplicationStats = async (req, res) => {
  try {
    const stats = await ShelterApplication.getStats();
    const supportTypeStats = await ShelterApplication.getSupportTypeStats();
    const cityStats = await ShelterApplication.getCityStats();

    return res.json({
      success: true,
      stats,
      supportTypeStats,
      cityStats,
    });
  } catch (error) {
    console.error("[shelter.controller/getApplicationStats]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const bulkUpdateStatus = async (req, res) => {
  const { applicationIds, status, notes } = req.body;

  if (
    !applicationIds ||
    !Array.isArray(applicationIds) ||
    applicationIds.length === 0
  ) {
    return res.status(400).json({
      success: false,
      error: "Application IDs array is required",
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

    for (const id of applicationIds) {
      try {
        const application = await ShelterApplication.updateStatus(
          id,
          status,
          notes,
          req.user?.id,
        );
        if (application) {
          successCount++;
          results.push({ id, success: true });
        } else {
          errorCount++;
          results.push({ id, success: false, error: "Application not found" });
        }
      } catch (err) {
        errorCount++;
        results.push({ id, success: false, error: err.message });
      }
    }

    return res.json({
      success: true,
      message: `Updated ${successCount} applications, ${errorCount} failed`,
      results,
      summary: { total: applicationIds.length, successCount, errorCount },
    });
  } catch (error) {
    console.error("[shelter.controller/bulkUpdateStatus]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};
