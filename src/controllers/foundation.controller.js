import FoundationDonation from "../models/FoundationDonation.js";

// ── Flutterwave configuration ──────────────────────────────────────────
const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
const FLW_SECRET_HASH = process.env.FLW_SECRET_HASH;
const FLW_BASE = "https://api.flutterwave.com/v3";

// ── Validation constants ──────────────────────────────────────────────
const VALID_STATUSES = ["pending", "completed", "failed", "refunded"];
const VALID_DONATION_TYPES = ["once", "monthly"];

// ── Flutterwave Request Helper ────────────────────────────────────────
async function flutterwaveRequest(method, path, body) {
  const res = await fetch(`${FLW_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${FLW_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ──────────────────────────────────────────────────────────────────────
// PUBLIC ROUTES (No authentication required)
// ──────────────────────────────────────────────────────────────────────

export const createDonation = async (req, res) => {
  const {
    donorName,
    donorEmail,
    donorMessage,
    amount,
    donationType,
    paymentMethod,
  } = req.body;

  // ─── Validation ──────────────────────────────────────────────────
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

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(donorEmail)) {
    return res.status(400).json({
      success: false,
      error: "Invalid email address",
    });
  }

  if (amount < 100) {
    return res.status(400).json({
      success: false,
      error: "Minimum donation amount is ₦100",
    });
  }

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
      paymentMethod: paymentMethod || "flutterwave",
    });

    // ── Initialize Flutterwave Transaction ─────────────────────────
    const payload = {
      tx_ref: paymentReference,
      amount: Number(amount),
      currency: "NGN",
      redirect_url: `${process.env.CLIENT_URL || "http://localhost:5173"}/foundation/verify?reference=${paymentReference}`,
      customer: {
        email: donorEmail,
        name: donorName,
      },
      customizations: {
        title: "Foundation Donation",
        description: `Donation from ${donorName}`,
        logo: process.env.LOGO_URL || "",
      },
      meta: {
        donor_name: donorName,
        donor_email: donorEmail,
        donation_id: donation.id,
        donation_type: donationType || "once",
      },
    };

    const flutterwaveRes = await flutterwaveRequest(
      "POST",
      "/payments",
      payload,
    );

    if (flutterwaveRes.status !== "success") {
      await FoundationDonation.updateStatus(
        donation.id,
        "failed",
        `Flutterwave error: ${flutterwaveRes.message}`,
      );

      return res.status(502).json({
        success: false,
        error: "Payment gateway initialization failed",
        details: flutterwaveRes.message,
      });
    }

    const { tx_ref, link, flw_ref, payment_id } = flutterwaveRes.data;

    // Update donation with Flutterwave data
    await FoundationDonation.updateStatus(
      donation.id,
      "pending",
      `Flutterwave initialized: ${tx_ref}`,
    );
    await FoundationDonation.updateAdminNotes(
      donation.id,
      `Flutterwave payment ID: ${payment_id} | Reference: ${flw_ref}`,
    );

    console.log(`[foundation] Donation initiated: ${tx_ref} for ${donorEmail}`);

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
        link,
        tx_ref,
        payment_id,
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

// ── Verify Flutterwave Payment ──────────────────────────────────────
export const verifyDonationPayment = async (req, res) => {
  const { reference } = req.query;

  if (!reference) {
    return res.status(400).json({
      success: false,
      error: "Payment reference is required",
    });
  }

  try {
    // Find the donation
    const donations = await FoundationDonation.findByEmail("");
    const donation = donations.find((d) => d.payment_reference === reference);

    if (!donation) {
      return res.status(404).json({
        success: false,
        error: "Donation not found",
      });
    }

    // If already completed, return success
    if (donation.status === "completed") {
      return res.json({
        success: true,
        message: "Payment already verified",
        donation: {
          id: donation.id,
          reference: donation.payment_reference,
          amount: donation.amount,
          status: donation.status,
        },
      });
    }

    // Verify with Flutterwave
    const flutterwaveRes = await flutterwaveRequest(
      "GET",
      `/transactions/verify_by_reference?tx_ref=${reference}`,
    );

    if (flutterwaveRes.status !== "success") {
      return res.status(400).json({
        success: false,
        error: "Payment verification failed",
        details: flutterwaveRes.message,
      });
    }

    const data = flutterwaveRes.data;

    if (data.status === "successful") {
      await FoundationDonation.updateStatus(
        donation.id,
        "completed",
        `Flutterwave verification: ${data.status}`,
        new Date(),
      );
      await FoundationDonation.updateAdminNotes(
        donation.id,
        `Flutterwave transaction: ${data.id} | Amount: ${data.amount} ${data.currency}`,
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
          id: data.id,
          amount: data.amount,
          currency: data.currency,
          status: data.status,
        },
      });
    } else {
      await FoundationDonation.updateStatus(
        donation.id,
        "failed",
        `Flutterwave verification failed: ${data.status}`,
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

// ── Flutterwave Webhook ──────────────────────────────────────────────
export const webhook = async (req, res) => {
  const signature = req.headers["verif-hash"];
  if (!signature || signature !== FLW_SECRET_HASH) {
    return res.status(401).json({ error: "invalid signature" });
  }

  const { event, data } = req.body;

  try {
    // Only process charge.completed events
    if (event !== "charge.completed") {
      return res.sendStatus(200);
    }

    const tx_ref = data.tx_ref;
    const status = data.status;

    // Find donation by payment reference
    const donations = await FoundationDonation.findByEmail("");
    const donation = donations.find((d) => d.payment_reference === tx_ref);

    if (!donation) {
      console.warn(`[foundation] Donation not found for tx_ref: ${tx_ref}`);
      return res.sendStatus(200);
    }

    // Don't update if already completed
    if (donation.status === "completed") {
      return res.sendStatus(200);
    }

    if (status === "successful") {
      await FoundationDonation.updateStatus(
        donation.id,
        "completed",
        `Webhook: charge.completed for ${tx_ref}`,
        new Date(),
      );
      await FoundationDonation.updateAdminNotes(
        donation.id,
        `Flutterwave transaction: ${data.id} | Amount: ${data.amount} ${data.currency}`,
      );
      console.log(
        `[foundation] Webhook: Donation ${tx_ref} marked as completed`,
      );
    } else if (status === "cancelled") {
      await FoundationDonation.updateStatus(
        donation.id,
        "failed",
        `Webhook: payment cancelled for ${tx_ref}`,
      );
      console.log(`[foundation] Webhook: Donation ${tx_ref} cancelled`);
    } else {
      // Other statuses: pending, etc.
      console.log(`[foundation] Webhook: Donation ${tx_ref} status: ${status}`);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("[foundation/webhook]", err);
    return res.sendStatus(500);
  }
};

// ──────────────────────────────────────────────────────────────────────
// ADMIN ROUTES (Authentication required) – unchanged
// ──────────────────────────────────────────────────────────────────────

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
