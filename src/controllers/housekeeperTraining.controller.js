// src/controllers/housekeeperTraining.controller.js
import HousekeeperApplication from "../models/HousekeeperApplication.js";

// Track options for validation
const VALID_TRACKS = [
  "Household Management",
  "Laundry & Linen Care",
  "Home Organisation",
  "Meal Prep & Kitchen Support",
  "Luxury & Estate Housekeeping",
  "Childcare-Safe Housekeeping",
  "Not sure - recommend one for me",
];

const VALID_CITIES = ["Abuja", "Lagos"];
const VALID_EXPERIENCE_LEVELS = ["none", "under1", "1-2", "3-5", "5+"];
const VALID_STATUSES = [
  "pending",
  "reviewed",
  "accepted",
  "rejected",
  "enrolled",
];

// ─────────────────────────────────────────────────────────────
// PUBLIC ROUTES (No authentication required)
// ─────────────────────────────────────────────────────────────

export const createApplication = async (req, res) => {
  const {
    name,
    email,
    phone,
    city,
    track,
    experience,
    motivation,
    availability,
  } = req.body;

  // ─── Validation ───────────────────────────────────────────
  const missing = [];
  if (!name) missing.push("name");
  if (!email) missing.push("email");
  if (!phone) missing.push("phone");
  if (!city) missing.push("city");
  if (!track) missing.push("track");
  if (!motivation) missing.push("motivation");

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

  // Track validation
  if (!VALID_TRACKS.includes(track)) {
    return res.status(400).json({
      success: false,
      error: "Invalid training track selection",
    });
  }

  // Experience validation (if provided)
  if (experience && !VALID_EXPERIENCE_LEVELS.includes(experience)) {
    return res.status(400).json({
      success: false,
      error: "Invalid experience level",
    });
  }

  try {
    // Check for duplicate application (same email within last 30 days)
    const existingApplications =
      await HousekeeperApplication.findByEmail(email);
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
    const application = await HousekeeperApplication.create({
      fullName: name,
      email,
      phone,
      city,
      preferredTrack: track,
      experienceLevel: experience || null,
      motivation,
      availability: availability || [],
    });

    console.log(
      `[housekeeper-training] New application from ${email} (${application.reference_number})`,
    );

    return res.status(201).json({
      success: true,
      message: "Application submitted successfully",
      application: {
        id: application.id,
        referenceNumber: application.reference_number,
        fullName: application.full_name,
        email: application.email,
        status: application.status,
        applicationDate: application.application_date,
      },
    });
  } catch (error) {
    console.error("[housekeeperTraining.controller/createApplication]", error);
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
  const { status, city, track, page = 1, limit = 50 } = req.query;

  try {
    const result = await HousekeeperApplication.findAll({
      status,
      city,
      track,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[housekeeperTraining.controller/listApplications]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const getApplication = async (req, res) => {
  const { id } = req.params;

  try {
    const application = await HousekeeperApplication.findById(id);

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
    console.error("[housekeeperTraining.controller/getApplication]", error);
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
    const application = await HousekeeperApplication.updateStatus(
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
    console.error(
      "[housekeeperTraining.controller/updateApplicationStatus]",
      error,
    );
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
    const application = await HousekeeperApplication.updateAdminNotes(
      id,
      notes,
    );

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
    console.error("[housekeeperTraining.controller/updateAdminNotes]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const deleteApplication = async (req, res) => {
  const { id } = req.params;

  try {
    const application = await HousekeeperApplication.delete(id);

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
    console.error("[housekeeperTraining.controller/deleteApplication]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const getApplicationStats = async (req, res) => {
  try {
    const stats = await HousekeeperApplication.getStats();

    return res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error(
      "[housekeeperTraining.controller/getApplicationStats]",
      error,
    );
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
        const application = await HousekeeperApplication.updateStatus(
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
    console.error("[housekeeperTraining.controller/bulkUpdateStatus]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};
