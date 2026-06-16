// src/controllers/foundation.controller.js
import FoundationDonation from "../models/FoundationDonation.js";
import crypto from "crypto";

// Validation options
const VALID_STATUSES = ["pending", "completed", "failed", "refunded"];
const VALID_DONATION_TYPES = ["once", "monthly"];

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

// ─────────────────────────────────────────────────────────────
// PUBLIC ROUTES (No authentication required)
// ─────────────────────────────────────────────────────────────

export const createDonation = async (req, res) => {
  const {
    donorName,
    donorEmail,
    donorMessage,
    amount,
    donationType,
    paymentMethod,
  } = req.body;

  // ─── Validation ───────────────────────────────────────────
  const missing = [];
  if (!donorName) missing.push("donorName");
  if (!donorEmail) missing.push("donorEmail");
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
  if (!emailRegex.test(donorEmail)) {
    return res.status(400).json({
      success: false,
      error: "Invalid email address",
    });
  }

  // Amount validation
  if (amount < 100) {
    return res.status(400).json({
      success: false,
      error: "Minimum donation amount is ₦100",
    });
  }

  // Donation type validation
  if (donationType && !VALID_DONATION_TYPES.includes(donationType)) {
    return res.status(400).json({
      success: false,
      error: "Invalid donation type",
    });
  }

  try {
    // Generate payment reference
    const paymentReference = `FD-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 10000)}`;

    // Create the donation record
    const donation = await FoundationDonation.create({
      donorName,
      donorEmail,
      donorMessage: donorMessage || null,
      amount,
      donationType: donationType || "once",
      paymentReference,
      paymentMethod: paymentMethod || "paystack",
    });

    // ── Initialize Paystack Transaction ────────────────────
    const paystackRes = await paystackRequest(
      "POST",
      "/transaction/initialize",
      {
        email: donorEmail,
        amount: Math.round(Number(amount) * 100), // Convert to kobo
        currency: "NGN",
        reference: paymentReference,
        callback_url: `${process.env.CLIENT_URL || "http://localhost:5173"}/foundation/verify?reference=${paymentReference}`,
        metadata: {
          donor_name: donorName,
          donor_email: donorEmail,
          donation_id: donation.id,
          donation_type: donationType || "once",
        },
      },
    );

    if (!paystackRes.status) {
      // If Paystack initialization fails, mark donation as failed
      await FoundationDonation.updateStatus(
        donation.id,
        "failed",
        `Paystack error: ${paystackRes.message}`,
      );

      return res.status(502).json({
        success: false,
        error: "Payment gateway initialization failed",
        details: paystackRes.message,
      });
    }

    // Update donation with Paystack data
    await FoundationDonation.updateStatus(
      donation.id,
      "pending",
      `Paystack initialized: ${paystackRes.data.reference}`,
    );

    console.log(
      `[foundation] Donation initiated: ${paymentReference} for ${donorEmail}`,
    );

    return res.status(201).json({
      success: true,
      message: "Donation initiated successfully",
      donation: {
        id: donation.id,
        paymentReference: donation.payment_reference,
        donorName: donation.donor_name,
        donorEmail: donation.donor_email,
        amount: donation.amount,
        donationType: donation.donation_type,
        status: donation.status,
        createdAt: donation.created_at,
      },
      payment: {
        authorization_url: paystackRes.data.authorization_url,
        access_code: paystackRes.data.access_code,
        reference: paystackRes.data.reference,
      },
    });
  } catch (error) {
    console.error("[foundation.controller/createDonation]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error. Please try again later.",
    });
  }
};

// ── Verify Paystack Payment ──────────────────────────────────────────────
export const verifyDonationPayment = async (req, res) => {
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

    // Find the donation
    const donations = await FoundationDonation.findByEmail(
      data.customer?.email || "",
    );
    const donation = donations.find((d) => d.payment_reference === reference);

    if (!donation) {
      return res.status(404).json({
        success: false,
        error: "Donation not found",
      });
    }

    // Update donation status based on payment status
    if (data.status === "success") {
      await FoundationDonation.updateStatus(
        donation.id,
        "completed",
        `Paystack verification: ${data.status}`,
        new Date(),
      );

      // Update with transaction details
      await FoundationDonation.updateAdminNotes(
        donation.id,
        `Paystack transaction: ${data.reference} | Amount: ${data.amount / 100} ${data.currency}`,
      );

      return res.json({
        success: true,
        message: "Payment verified successfully",
        donation: {
          id: donation.id,
          reference: donation.payment_reference,
          amount: donation.amount,
          status: "completed",
        },
        transaction: {
          reference: data.reference,
          amount: data.amount / 100,
          currency: data.currency,
          status: data.status,
        },
      });
    } else {
      await FoundationDonation.updateStatus(
        donation.id,
        "failed",
        `Paystack verification failed: ${data.status}`,
      );

      return res.status(400).json({
        success: false,
        error: "Payment was not successful",
        status: data.status,
      });
    }
  } catch (error) {
    console.error("[foundation.controller/verifyDonationPayment]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

// ── Paystack Webhook ──────────────────────────────────────────────────────
export const webhook = async (req, res) => {
  const signature = req.headers["x-paystack-signature"];
  const hash = crypto
    .createHmac("sha512", PAYSTACK_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash !== signature) {
    return res.status(401).json({ error: "invalid signature" });
  }

  const { event, data } = req.body;

  try {
    if (event === "charge.success") {
      const reference = data.reference;

      // Find donation by payment reference
      const donations = await FoundationDonation.findByEmail(
        data.customer?.email || "",
      );
      const donation = donations.find((d) => d.payment_reference === reference);

      if (donation) {
        await FoundationDonation.updateStatus(
          donation.id,
          "completed",
          `Webhook: charge.success for ${reference}`,
          new Date(),
        );
        console.log(
          `[foundation] Webhook: Donation ${reference} marked as completed`,
        );
      }
    }

    if (event === "refund.processed") {
      const reference = data.transaction_reference;
      const donations = await FoundationDonation.findByEmail(
        data.customer?.email || "",
      );
      const donation = donations.find((d) => d.payment_reference === reference);

      if (donation) {
        await FoundationDonation.updateStatus(
          donation.id,
          "refunded",
          `Webhook: refund.processed for ${reference}`,
        );
        console.log(
          `[foundation] Webhook: Donation ${reference} marked as refunded`,
        );
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("[foundation/webhook]", err);
    return res.sendStatus(500);
  }
};

// ─────────────────────────────────────────────────────────────
// ADMIN ROUTES (Authentication required)
// ─────────────────────────────────────────────────────────────

export const listDonations = async (req, res) => {
  const { status, donationType, page = 1, limit = 50 } = req.query;

  try {
    const result = await FoundationDonation.findAll({
      status,
      donationType,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[foundation.controller/listDonations]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const getDonation = async (req, res) => {
  const { id } = req.params;

  try {
    const donation = await FoundationDonation.findById(id);

    if (!donation) {
      return res.status(404).json({
        success: false,
        error: "Donation not found",
      });
    }

    return res.json({
      success: true,
      donation,
    });
  } catch (error) {
    console.error("[foundation.controller/getDonation]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const updateDonationStatus = async (req, res) => {
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
    const completedAt = status === "completed" ? new Date() : null;
    const donation = await FoundationDonation.updateStatus(
      id,
      status,
      notes || null,
      completedAt,
    );

    if (!donation) {
      return res.status(404).json({
        success: false,
        error: "Donation not found",
      });
    }

    return res.json({
      success: true,
      message: "Donation status updated successfully",
      donation,
    });
  } catch (error) {
    console.error("[foundation.controller/updateDonationStatus]", error);
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
    const donation = await FoundationDonation.updateAdminNotes(id, notes);

    if (!donation) {
      return res.status(404).json({
        success: false,
        error: "Donation not found",
      });
    }

    return res.json({
      success: true,
      message: "Admin notes updated successfully",
      donation,
    });
  } catch (error) {
    console.error("[foundation.controller/updateAdminNotes]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const deleteDonation = async (req, res) => {
  const { id } = req.params;

  try {
    const donation = await FoundationDonation.delete(id);

    if (!donation) {
      return res.status(404).json({
        success: false,
        error: "Donation not found",
      });
    }

    return res.json({
      success: true,
      message: "Donation deleted successfully",
      donation,
    });
  } catch (error) {
    console.error("[foundation.controller/deleteDonation]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const getDonationStats = async (req, res) => {
  try {
    const stats = await FoundationDonation.getStats();
    const monthlyStats = await FoundationDonation.getMonthlyStats();

    return res.json({
      success: true,
      stats,
      monthlyStats,
    });
  } catch (error) {
    console.error("[foundation.controller/getDonationStats]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

export const bulkUpdateStatus = async (req, res) => {
  const { donationIds, status, notes } = req.body;

  if (!donationIds || !Array.isArray(donationIds) || donationIds.length === 0) {
    return res.status(400).json({
      success: false,
      error: "Donation IDs array is required",
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
    const completedAt = status === "completed" ? new Date() : null;

    for (const id of donationIds) {
      try {
        const donation = await FoundationDonation.updateStatus(
          id,
          status,
          notes || null,
          completedAt,
        );
        if (donation) {
          successCount++;
          results.push({ id, success: true });
        } else {
          errorCount++;
          results.push({ id, success: false, error: "Donation not found" });
        }
      } catch (err) {
        errorCount++;
        results.push({ id, success: false, error: err.message });
      }
    }

    return res.json({
      success: true,
      message: `Updated ${successCount} donations, ${errorCount} failed`,
      results,
      summary: { total: donationIds.length, successCount, errorCount },
    });
  } catch (error) {
    console.error("[foundation.controller/bulkUpdateStatus]", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};
