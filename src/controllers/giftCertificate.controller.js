// src/controllers/giftCertificate.controller.js
import GiftCertificate from "../models/GiftCertificate.js";
import crypto from "crypto";

// Paystack configuration
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE = "https://api.paystack.co";

// ── Paystack Request Helper ─────────────────────────────────────────────
async function paystackRequest(method, path, body) {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// Validation options
const VALID_STATUSES = ["active", "redeemed", "expired", "cancelled"];
const VALID_OCCASIONS = [
  "Birthday",
  "Wedding",
  "New Home",
  "New Baby",
  "Work Milestone",
  "Christmas",
  "Valentine's",
  "Mother's Day",
  "Graduation",
  "Get Well",
];

// ─────────────────────────────────────────────────────────────
// PUBLIC ROUTES (No authentication required)
// ─────────────────────────────────────────────────────────────

export const createCertificate = async (req, res) => {
  const { from, to, email, date, message, amount, occasion } = req.body;

  // ─── Validation ───────────────────────────────────────────
  const missing = [];
  if (!from) missing.push("from");
  if (!to) missing.push("to");
  if (!email) missing.push("email");
  if (!amount) missing.push("amount");

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

  // Amount validation
  if (amount < 1000) {
    return res.status(400).json({
      success: false,
      error: "Minimum gift certificate amount is ₦1,000",
    });
  }

  // Occasion validation (if provided)
  if (occasion && !VALID_OCCASIONS.includes(occasion)) {
    return res.status(400).json({
      success: false,
      error: "Invalid occasion selection",
    });
  }

  try {
    // Generate purchase reference
    const purchaseReference = `GIFT-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 10000)}`;

    // Create the gift certificate record
    const certificate = await GiftCertificate.create({
      fromName: from,
      recipientName: to,
      recipientEmail: email,
      amount: amount,
      message: message || null,
      deliveryDate: date || null,
      occasion: occasion || null,
      purchaseReference: purchaseReference,
      paymentMethod: "paystack",
    });

    // ── Initialize Paystack Transaction ────────────────────
    const paystackRes = await paystackRequest(
      "POST",
      "/transaction/initialize",
      {
        email: email,
        amount: Math.round(Number(amount) * 100), // Convert to kobo
        currency: "NGN",
        reference: purchaseReference,
        callback_url: `${process.env.CLIENT_URL || "http://localhost:5173"}/gift-certificates/verify?reference=${purchaseReference}`,
        metadata: {
          from_name: from,
          recipient_name: to,
          recipient_email: email,
          certificate_id: certificate.id,
          type: "gift_certificate",
        },
      },
    );

    if (!paystackRes.status) {
      // If Paystack initialization fails, mark certificate as cancelled
      await GiftCertificate.updateStatus(
        certificate.id,
        "cancelled",
        `Paystack error: ${paystackRes.message}`,
      );

      return res.status(502).json({
        success: false,
        error: "Payment gateway initialization failed",
        details: paystackRes.message,
      });
    }

    console.log(
      `[gift-certificate] Certificate created: ${certificate.certificate_code} for ${email}`,
    );

    return res.status(201).json({
      success: true,
      message: "Gift certificate created successfully",
      certificate: {
        id: certificate.id,
        code: certificate.certificate_code,
        amount: certificate.amount,
        from: certificate.from_name,
        to: certificate.recipient_name,
        email: certificate.recipient_email,
        status: certificate.status,
        expiresAt: certificate.expires_at,
      },
      payment: {
        authorization_url: paystackRes.data.authorization_url,
        access_code: paystackRes.data.access_code,
        reference: paystackRes.data.reference,
      },
    });
  } catch (error) {
    console.error("[giftCertificate.controller/createCertificate]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error. Please try again later.",
    });
  }
};

// ── Verify Paystack Payment ──────────────────────────────────────────────
export const verifyCertificatePayment = async (req, res) => {
  const { reference } = req.query;

  if (!reference) {
    return res.status(400).json({
      success: false,
      error: "Payment reference is required",
    });
  }

  try {
    // Verify with Paystack
    const paystackRes = await paystackRequest(
      "GET",
      `/transaction/verify/${reference}`,
    );

    if (!paystackRes.status) {
      return res.status(400).json({
        success: false,
        error: "Payment verification failed",
        details: paystackRes.message,
      });
    }

    const data = paystackRes.data;

    // Find the certificate by purchase reference using req.db
    const { rows } = await req.db.query(
      `SELECT * FROM gift_certificates WHERE purchase_reference = $1`,
      [reference],
    );

    const certificate = rows[0];

    if (!certificate) {
      return res.status(404).json({
        success: false,
        error: "Gift certificate not found",
      });
    }

    // Update certificate status based on payment status
    if (data.status === "success") {
      await GiftCertificate.updateStatus(
        certificate.id,
        "active",
        `Paystack verification: ${data.status}`,
      );

      // TODO: Send email to recipient with gift certificate

      return res.json({
        success: true,
        message: "Payment verified successfully",
        certificate: {
          code: certificate.certificate_code,
          amount: certificate.amount,
          from: certificate.from_name,
          to: certificate.recipient_name,
          status: "active",
          expiresAt: certificate.expires_at,
        },
        transaction: {
          reference: data.reference,
          amount: data.amount / 100,
          currency: data.currency,
          status: data.status,
        },
      });
    } else {
      await GiftCertificate.updateStatus(
        certificate.id,
        "cancelled",
        `Paystack verification failed: ${data.status}`,
      );

      return res.status(400).json({
        success: false,
        error: "Payment was not successful",
        status: data.status,
      });
    }
  } catch (error) {
    console.error(
      "[giftCertificate.controller/verifyCertificatePayment]",
      error,
    );
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

// ── Redeem Gift Certificate ──────────────────────────────────────────────
export const redeemCertificate = async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({
      success: false,
      error: "Certificate code is required",
    });
  }

  try {
    // Find certificate by code
    const certificate = await GiftCertificate.findByCode(code);

    if (!certificate) {
      return res.status(404).json({
        success: false,
        error: "Invalid gift certificate code",
      });
    }

    if (certificate.status === "redeemed") {
      return res.status(400).json({
        success: false,
        error: "This gift certificate has already been redeemed",
      });
    }

    if (certificate.status === "expired") {
      return res.status(400).json({
        success: false,
        error: "This gift certificate has expired",
      });
    }

    if (certificate.status === "cancelled") {
      return res.status(400).json({
        success: false,
        error: "This gift certificate has been cancelled",
      });
    }

    if (new Date(certificate.expires_at) < new Date()) {
      await GiftCertificate.updateStatus(
        certificate.id,
        "expired",
        "Auto-expired: certificate expired",
      );
      return res.status(400).json({
        success: false,
        error: "This gift certificate has expired",
      });
    }

    // Redeem the certificate
    const redeemed = await GiftCertificate.redeemCertificate(
      code,
      req.user?.id || null,
      null, // booking_id will be set when used for booking
    );

    return res.json({
      success: true,
      message: "Gift certificate redeemed successfully",
      certificate: {
        code: redeemed.certificate_code,
        amount: redeemed.amount,
        from: redeemed.from_name,
        expiresAt: redeemed.expires_at,
      },
    });
  } catch (error) {
    console.error("[giftCertificate.controller/redeemCertificate]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

// ── Verify Certificate Balance ────────────────────────────────────────────
export const verifyCertificate = async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({
      success: false,
      error: "Certificate code is required",
    });
  }

  try {
    const certificate = await GiftCertificate.findByCode(code);

    if (!certificate) {
      return res.status(404).json({
        success: false,
        error: "Invalid gift certificate code",
      });
    }

    const isValid =
      certificate.status === "active" &&
      new Date(certificate.expires_at) > new Date();

    return res.json({
      success: true,
      valid: isValid,
      certificate: {
        code: certificate.certificate_code,
        amount: certificate.amount,
        from: certificate.from_name,
        to: certificate.recipient_name,
        status: certificate.status,
        expiresAt: certificate.expires_at,
        isValid: isValid,
      },
    });
  } catch (error) {
    console.error("[giftCertificate.controller/verifyCertificate]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

// ─────────────────────────────────────────────────────────────
// ADMIN ROUTES (Authentication required)
// ─────────────────────────────────────────────────────────────

export const listCertificates = async (req, res) => {
  const { status, occasion, page = 1, limit = 50 } = req.query;

  try {
    const result = await GiftCertificate.findAll({
      status,
      occasion,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[giftCertificate.controller/listCertificates]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const getCertificate = async (req, res) => {
  const { id } = req.params;

  try {
    const certificate = await GiftCertificate.findById(id);

    if (!certificate) {
      return res.status(404).json({
        success: false,
        error: "Gift certificate not found",
      });
    }

    return res.json({
      success: true,
      certificate,
    });
  } catch (error) {
    console.error("[giftCertificate.controller/getCertificate]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const updateCertificateStatus = async (req, res) => {
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
    const certificate = await GiftCertificate.updateStatus(
      id,
      status,
      notes || null,
    );

    if (!certificate) {
      return res.status(404).json({
        success: false,
        error: "Gift certificate not found",
      });
    }

    return res.json({
      success: true,
      message: "Certificate status updated successfully",
      certificate,
    });
  } catch (error) {
    console.error(
      "[giftCertificate.controller/updateCertificateStatus]",
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
    const certificate = await GiftCertificate.updateAdminNotes(id, notes);

    if (!certificate) {
      return res.status(404).json({
        success: false,
        error: "Gift certificate not found",
      });
    }

    return res.json({
      success: true,
      message: "Admin notes updated successfully",
      certificate,
    });
  } catch (error) {
    console.error("[giftCertificate.controller/updateAdminNotes]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const deleteCertificate = async (req, res) => {
  const { id } = req.params;

  try {
    const certificate = await GiftCertificate.delete(id);

    if (!certificate) {
      return res.status(404).json({
        success: false,
        error: "Gift certificate not found",
      });
    }

    return res.json({
      success: true,
      message: "Gift certificate deleted successfully",
      certificate,
    });
  } catch (error) {
    console.error("[giftCertificate.controller/deleteCertificate]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const getCertificateStats = async (req, res) => {
  try {
    const stats = await GiftCertificate.getStats();
    const occasionStats = await GiftCertificate.getOccasionStats();

    return res.json({
      success: true,
      stats,
      occasionStats,
    });
  } catch (error) {
    console.error("[giftCertificate.controller/getCertificateStats]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const bulkUpdateStatus = async (req, res) => {
  const { certificateIds, status, notes } = req.body;

  if (
    !certificateIds ||
    !Array.isArray(certificateIds) ||
    certificateIds.length === 0
  ) {
    return res.status(400).json({
      success: false,
      error: "Certificate IDs array is required",
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

    for (const id of certificateIds) {
      try {
        const certificate = await GiftCertificate.updateStatus(
          id,
          status,
          notes || null,
        );
        if (certificate) {
          successCount++;
          results.push({ id, success: true });
        } else {
          errorCount++;
          results.push({ id, success: false, error: "Certificate not found" });
        }
      } catch (err) {
        errorCount++;
        results.push({ id, success: false, error: err.message });
      }
    }

    return res.json({
      success: true,
      message: `Updated ${successCount} certificates, ${errorCount} failed`,
      results,
      summary: { total: certificateIds.length, successCount, errorCount },
    });
  } catch (error) {
    console.error("[giftCertificate.controller/bulkUpdateStatus]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};
