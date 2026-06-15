// src/controllers/domesticCertification.controller.js
import DomesticCertificationApplication from "../models/DomesticCertificationApplication.js";

// Validation options
const VALID_PROGRAMS = [
  "Household Management",
  "Professional Cooking & Culinary",
  "Professional Childcare",
  "Elderly Companion Care",
  "Laundry & Textile Care",
  "Hospitality & Service",
];

const VALID_CITIES = [
  "Lagos (Ikoyi, VI, Lekki)",
  "Lagos (Ikeja, GRA)",
  "Lagos (Surulere, Yaba)",
  "Abuja (Maitama, Asokoro)",
  "Abuja (Wuse, Garki)",
  "Port Harcourt (GRA)",
  "Ibadan (Jericho, Bodija)",
  "Kano (Nassarawa GRA)",
  "Enugu (Independence Layout)",
];

const VALID_EXPERIENCE_LEVELS = ["none", "less1", "1-2", "3-5", "5+"];
const VALID_EDUCATION_LEVELS = [
  "primary",
  "secondary",
  "diploma",
  "degree",
  "postgraduate",
];
const VALID_STATUSES = [
  "pending",
  "reviewed",
  "accepted",
  "rejected",
  "enrolled",
];
const VALID_SCHEDULE_OPTIONS = [
  "Full-time (Mon-Thu 9AM-3PM) - 4 weeks",
  "Part-time (Mon-Wed 6PM-9PM) - 8 weeks",
  "Weekend (Sat-Sun 10AM-4PM) - 8 weeks",
  "Flexible (Self-paced with labs) - Up to 12 weeks",
];

// ─────────────────────────────────────────────────────────────
// PUBLIC ROUTES (No authentication required)
// ─────────────────────────────────────────────────────────────

export const createApplication = async (req, res) => {
  const {
    fullName,
    email,
    phone,
    city,
    programChoice,
    experience,
    education,
    previousTraining,
    schedulePreference,
    startMonth,
    motivation,
    referralCode,
    hearAbout,
    emergencyContact,
    emergencyPhone,
  } = req.body;

  // ─── Validation ───────────────────────────────────────────
  const missing = [];
  if (!fullName) missing.push("fullName");
  if (!email) missing.push("email");
  if (!phone) missing.push("phone");
  if (!city) missing.push("city");
  if (!programChoice) missing.push("programChoice");
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

  // Program validation
  if (!VALID_PROGRAMS.includes(programChoice)) {
    return res.status(400).json({
      success: false,
      error: "Invalid program selection",
    });
  }

  // Experience validation
  if (experience && !VALID_EXPERIENCE_LEVELS.includes(experience)) {
    return res.status(400).json({
      success: false,
      error: "Invalid experience level",
    });
  }

  // Education validation
  if (education && !VALID_EDUCATION_LEVELS.includes(education)) {
    return res.status(400).json({
      success: false,
      error: "Invalid education level",
    });
  }

  try {
    // Check for duplicate application
    const existingApplications =
      await DomesticCertificationApplication.findByEmail(email);
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
    const application = await DomesticCertificationApplication.create({
      fullName,
      email,
      phone,
      city,
      programChoice,
      experienceLevel: experience || null,
      educationLevel: education || null,
      previousTraining: previousTraining || null,
      schedulePreference: schedulePreference || null,
      startMonth: startMonth || null,
      motivation,
      referralCode: referralCode || null,
      hearAbout: hearAbout || null,
      emergencyContact: emergencyContact || null,
      emergencyPhone: emergencyPhone || null,
    });

    console.log(
      `[domestic-certification] New application from ${email} (${application.reference_number})`,
    );

    // Check for referral bonus
    if (referralCode && referralCode === "DEUSIZI-DOMESTIC-2026") {
      console.log(`[domestic-certification] Referral code used by ${email}`);
    }

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
    console.error(
      "[domesticCertification.controller/createApplication]",
      error,
    );
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
  const { status, city, program, page = 1, limit = 50 } = req.query;

  try {
    const result = await DomesticCertificationApplication.findAll({
      status,
      city,
      program,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[domesticCertification.controller/listApplications]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const getApplication = async (req, res) => {
  const { id } = req.params;

  try {
    const application = await DomesticCertificationApplication.findById(id);

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
    console.error("[domesticCertification.controller/getApplication]", error);
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
    const application = await DomesticCertificationApplication.updateStatus(
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
      "[domesticCertification.controller/updateApplicationStatus]",
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
    const application = await DomesticCertificationApplication.updateAdminNotes(
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
    console.error("[domesticCertification.controller/updateAdminNotes]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const deleteApplication = async (req, res) => {
  const { id } = req.params;

  try {
    const application = await DomesticCertificationApplication.delete(id);

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
    console.error(
      "[domesticCertification.controller/deleteApplication]",
      error,
    );
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const getApplicationStats = async (req, res) => {
  try {
    const stats = await DomesticCertificationApplication.getStats();

    return res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error(
      "[domesticCertification.controller/getApplicationStats]",
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
        const application = await DomesticCertificationApplication.updateStatus(
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
    console.error("[domesticCertification.controller/bulkUpdateStatus]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};
