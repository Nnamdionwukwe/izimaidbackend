import crypto from "crypto";
import {
  sendPaymentReceipt,
  sendNewBookingToMaid,
  sendBookingCancelledEmail,
} from "../utils/mailer.js";
import { notify } from "../utils/notify.js";

const COINBASE_KEY = process.env.COINBASE_COMMERCE_API_KEY;
// ── 4. Crypto payment via static Trust Wallet addresses ──────────────

// Supported currencies with their wallet addresses (store in .env)
const CRYPTO_WALLETS = {
  BTC: process.env.CRYPTO_BTC_ADDRESS,
  ETH: process.env.CRYPTO_ETH_ADDRESS,
  USDT: process.env.CRYPTO_USDT_ADDRESS,
  BNB: process.env.CRYPTO_BNB_ADDRESS,
  USDC: process.env.CRYPTO_USDC_ADDRESS,
};
const PLATFORM_FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT || 10);

// ── Flutterwave config ──────────────────────────────────────────────
const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
const FLW_SECRET_HASH = process.env.FLW_SECRET_HASH;
const FLW_BASE = "https://api.flutterwave.com/v3";

// ── Flutterwave request helper ──────────────────────────────────────
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

// ── Platform fee – added ON TOP of the maid's service cost ──────────
function calcFees(serviceAmount) {
  const n = Number(serviceAmount);
  const platformFee =
    Math.round(((n * PLATFORM_FEE_PERCENT) / 100) * 100) / 100;
  const customerPays = Math.round((n + platformFee) * 100) / 100;
  const maidPayout = n;
  return { platformFee, maidPayout, customerPays };
}

export const initializeCryptoPayment = async (req, res) => {
  const { booking_id, currency = "USDT" } = req.body;
  if (!booking_id) {
    return res.status(400).json({ error: "booking_id is required" });
  }

  if (!CRYPTO_WALLETS[currency]) {
    return res.status(400).json({
      error: `Unsupported currency. Supported: ${Object.keys(CRYPTO_WALLETS).join(", ")}`,
    });
  }

  const address = CRYPTO_WALLETS[currency];
  if (!address) {
    return res.status(503).json({
      error: `Crypto payment not configured for ${currency} – missing wallet address`,
    });
  }

  try {
    const booking = await fetchBookingForPayment(
      req.db,
      booking_id,
      req.user.id,
    );
    if (!booking) {
      return res
        .status(404)
        .json({ error: "booking not found or already paid" });
    }

    const { platformFee, maidPayout, customerPays } = calcFees(
      Number(booking.total_amount),
    );

    await req.db.query(
      `INSERT INTO payments
         (booking_id, customer_id, amount, currency, gateway,
          platform_fee, maid_payout, crypto_currency, crypto_address, crypto_status)
       VALUES ($1,$2,$3,$4,'crypto',$5,$6,$7,$8,'pending')`,
      [
        booking_id,
        req.user.id,
        customerPays,
        booking.maid_currency || "NGN",
        platformFee,
        maidPayout,
        currency,
        address,
      ],
    );

    return res.json({
      gateway: "crypto",
      currency,
      address,
      expected_amount: customerPays,
      instructions: `Send exactly the expected amount (or as agreed) in ${currency} to the address above. Then submit the transaction hash and a proof screenshot.`,
      network:
        currency === "BTC"
          ? "Bitcoin"
          : currency === "ETH"
            ? "Ethereum"
            : "BSC",
    });
  } catch (err) {
    console.error("[payments/initializeCryptoPayment]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 5. Confirm crypto payment with TX hash + proof ────────────────
export const confirmCryptoPayment = async (req, res) => {
  const { booking_id, tx_hash, amount_sent, proof_url } = req.body;
  if (!booking_id || !tx_hash || !proof_url) {
    return res.status(400).json({
      error: "booking_id, tx_hash, and proof_url are required",
    });
  }

  try {
    const { rows } = await req.db.query(
      `UPDATE payments
       SET crypto_tx_hash = $1,
           crypto_proof_url = $2,
           crypto_amount_sent = $3,
           crypto_status = 'proof_submitted'
       WHERE booking_id = $4
         AND customer_id = $5
         AND gateway = 'crypto'
         AND crypto_status = 'pending'
       RETURNING *`,
      [tx_hash, proof_url, amount_sent || null, booking_id, req.user.id],
    );

    if (!rows.length) {
      return res.status(404).json({
        error: "No pending crypto payment found for this booking",
      });
    }

    return res.json({
      message:
        "Crypto payment proof submitted. Admin will verify the transaction on-chain shortly.",
      payment: rows[0],
    });
  } catch (err) {
    console.error("[payments/confirmCryptoPayment]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 6. Admin verify crypto payment ──────────────────────────────────
export const adminVerifyCryptoPayment = async (req, res) => {
  const { payment_id } = req.params;
  const { approved, notes } = req.body;
  if (typeof approved !== "boolean") {
    return res.status(400).json({ error: "approved must be true or false" });
  }

  try {
    const newStatus = approved ? "confirmed" : "failed";
    const paymentStatus = approved ? "success" : "failed";

    const { rows } = await req.db.query(
      `UPDATE payments
       SET crypto_status = $1,
           status = $2,
           paid_at = CASE WHEN $3 THEN now() ELSE NULL END,
           notes = COALESCE(notes, '') || ' ' || $4
       WHERE id = $5 AND gateway = 'crypto' AND crypto_status = 'proof_submitted'
       RETURNING *`,
      [newStatus, paymentStatus, approved, notes || "", payment_id],
    );

    if (!rows.length) {
      return res.status(404).json({
        error: "crypto payment not found or not in proof_submitted state",
      });
    }

    const payment = rows[0];
    if (approved) {
      await req.db.query(
        `UPDATE bookings SET status='pending', updated_at=now()
         WHERE id=$1 AND status='awaiting_payment'`,
        [payment.booking_id],
      );
      // Optionally send notifications / email receipt
    }

    return res.json({
      message: approved ? "Crypto payment verified" : "Crypto payment rejected",
      payment,
    });
  } catch (err) {
    console.error("[payments/adminVerifyCryptoPayment]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Admin list crypto payments ──────────────────────────────────────
export const adminListCryptoPayments = async (req, res) => {
  const { type } = req.query;
  const isHistory = type === "history";
  try {
    const { rows } = await req.db.query(
      `SELECT DISTINCT ON (p.id)
          p.id AS payment_id, p.amount AS expected_amount,
          p.crypto_amount_sent, p.currency,
          p.status, p.crypto_currency, p.crypto_address,
          p.crypto_tx_hash, p.crypto_proof_url, p.crypto_status,
          p.notes, p.paid_at, p.created_at,
          b.id AS booking_id, b.service_date, b.address, b.total_amount,
          b.duration_hours,
          c.name AS customer_name, c.email AS customer_email,
          m.name AS maid_name
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN users c ON c.id = b.customer_id
       JOIN users m ON m.id = b.maid_id
       WHERE p.gateway = 'crypto'
         AND p.crypto_status = ANY($1)
       ORDER BY p.id, p.created_at DESC
       LIMIT 100`,
      [isHistory ? ["confirmed", "failed"] : ["pending", "proof_submitted"]],
    );
    return res.json({ payments: rows });
  } catch (err) {
    console.error("[payments/adminListCryptoPayments]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Fetch booking for payment ─────────────────────────────────────────
async function fetchBookingForPayment(db, bookingId, customerId) {
  const { rows } = await db.query(
    `SELECT
       b.id, b.customer_id, b.maid_id, b.status,
       b.total_amount, b.service_date, b.address, b.duration_hours, b.notes,
       u.email, u.name AS customer_name,
       m.name AS maid_name, m.email AS maid_email,
       mp.currency AS maid_currency
     FROM bookings b
     JOIN users u  ON u.id  = b.customer_id
     JOIN users m  ON m.id  = b.maid_id
     LEFT JOIN maid_profiles mp ON mp.user_id = b.maid_id
     WHERE b.id = $1 AND b.customer_id = $2 AND b.status = 'awaiting_payment'`,
    [bookingId, customerId],
  );
  return rows[0] || null;
}

// ── 1. Initialize Flutterwave payment ────────────────────────────────
export const initializePayment = async (req, res) => {
  const { booking_id } = req.body;
  if (!booking_id)
    return res.status(400).json({ error: "booking_id is required" });

  try {
    const booking = await fetchBookingForPayment(
      req.db,
      booking_id,
      req.user.id,
    );
    if (!booking)
      return res
        .status(404)
        .json({ error: "booking not found or already paid" });

    const { rows: existing } = await req.db.query(
      `SELECT id FROM payments WHERE booking_id = $1 AND status = 'success'`,
      [booking_id],
    );
    if (existing.length)
      return res.status(409).json({ error: "booking already paid" });

    const { platformFee, maidPayout, customerPays } = calcFees(
      Number(booking.total_amount),
    );
    const currency = booking.maid_currency || "NGN";
    const reference = `ds_${booking_id}_${Date.now()}`;

    const payload = {
      tx_ref: reference,
      amount: customerPays,
      currency: currency,
      redirect_url: `${process.env.CLIENT_URL}/payment/verify?gateway=flutterwave&booking_id=${booking_id}`,
      customer: {
        email: booking.email,
        name: booking.customer_name,
      },
      customizations: {
        title: "Deusizi Sparkle – Cleaning Service",
        description: `${booking.duration_hours} hour(s) · ${new Date(booking.service_date).toLocaleDateString()}`,
        logo: process.env.LOGO_URL,
      },
      meta: {
        booking_id,
        customer_id: req.user.id,
      },
    };

    const flutterwaveRes = await flutterwaveRequest(
      "POST",
      "/payments",
      payload,
    );

    if (flutterwaveRes.status !== "success") {
      return res.status(502).json({
        error: "Flutterwave initialization failed",
        details: flutterwaveRes.message,
      });
    }

    const { tx_ref, link, payment_id } = flutterwaveRes.data;

    // Store Flutterwave data in existing columns
    await req.db.query(
      `INSERT INTO payments
         (booking_id, customer_id, amount, currency, gateway,
          paystack_reference, paystack_access_code, platform_fee, maid_payout, status)
       VALUES ($1,$2,$3,$4,'flutterwave',$5,$6,$7,$8,'pending')`,
      [
        booking_id,
        req.user.id,
        customerPays,
        currency,
        tx_ref,
        payment_id,
        platformFee,
        maidPayout,
      ],
    );

    return res.json({
      gateway: "flutterwave",
      link,
      tx_ref,
      payment_id,
    });
  } catch (err) {
    console.error("[payments/initializePayment]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 2. Bank transfer ───────────────────────────────────────────────────
export const initializeBankTransfer = async (req, res) => {
  const { booking_id } = req.body;
  if (!booking_id)
    return res.status(400).json({ error: "booking_id is required" });

  try {
    const booking = await fetchBookingForPayment(
      req.db,
      booking_id,
      req.user.id,
    );
    if (!booking)
      return res
        .status(404)
        .json({ error: "booking not found or already paid" });

    const { platformFee, maidPayout, customerPays } = calcFees(
      Number(booking.total_amount),
    );
    const transferRef = `BT-${booking_id.slice(0, 8).toUpperCase()}-${Date.now()}`;

    await req.db.query(
      `INSERT INTO payments
         (booking_id, customer_id, amount, currency, gateway,
          bank_transfer_ref, bank_transfer_status, platform_fee, maid_payout)
       VALUES ($1,$2,$3,$4,'bank_transfer',$5,'awaiting_proof',$6,$7)`,
      [
        booking_id,
        req.user.id,
        customerPays,
        booking.maid_currency || "NGN",
        transferRef,
        platformFee,
        maidPayout,
      ],
    );

    return res.json({
      gateway: "bank_transfer",
      reference: transferRef,
      amount: customerPays,
      currency: booking.maid_currency || "NGN",
      bank_details: {
        bank_name: process.env.BANK_NAME,
        account_number: process.env.BANK_ACCOUNT_NUMBER,
        account_name: process.env.BANK_ACCOUNT_NAME,
        narration: `Deusizi Booking ${transferRef}`,
      },
    });
  } catch (err) {
    console.error("[payments/initializeBankTransfer]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 3. Upload bank transfer proof ──────────────────────────────────────
export const confirmBankTransfer = async (req, res) => {
  const { booking_id, proof_url, reference } = req.body;
  if (!booking_id || !proof_url) {
    return res
      .status(400)
      .json({ error: "booking_id and proof_url are required" });
  }

  try {
    const { rows } = await req.db.query(
      `UPDATE payments
       SET bank_transfer_proof = $1, bank_transfer_status = 'proof_submitted',
           notes = $2
       WHERE booking_id = $3 AND customer_id = $4 AND gateway = 'bank_transfer'
         AND bank_transfer_status = 'awaiting_proof'
       RETURNING *`,
      [proof_url, `Reference: ${reference || "N/A"}`, booking_id, req.user.id],
    );
    if (!rows.length)
      return res.status(404).json({ error: "payment record not found" });
    return res.json({
      message: "Payment proof submitted. Admin will verify within 24 hours.",
      payment: rows[0],
    });
  } catch (err) {
    console.error("[payments/confirmBankTransfer]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 5. Verify payment ─────────────────────────────────────────────────
export const verifyPayment = async (req, res) => {
  const { reference, gateway } = req.query;

  try {
    // ── Flutterwave ──────────────────────────────────────────────
    if (gateway === "flutterwave" && reference) {
      const flutterwaveRes = await flutterwaveRequest(
        "GET",
        `/transactions/verify_by_reference?tx_ref=${reference}`,
      );

      if (
        flutterwaveRes.status !== "success" ||
        flutterwaveRes.data.status !== "successful"
      ) {
        await req.db.query(
          `UPDATE payments SET status='failed' WHERE paystack_reference=$1`,
          [reference],
        );
        return res.status(402).json({ error: "payment not successful" });
      }

      const booking_id = flutterwaveRes.data.meta?.booking_id;
      const client = await req.db.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE payments
           SET status='success', paid_at=now(),
               stripe_payment_id = $1
           WHERE paystack_reference = $2`,
          [flutterwaveRes.data.id, reference],
        );
        await client.query(
          `UPDATE bookings SET status='pending',updated_at=now()
           WHERE id=$1 AND status='awaiting_payment'`,
          [booking_id],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }

      const { rows: cr } = await req.db.query(
        `SELECT u.name,u.email FROM users u JOIN bookings b ON b.customer_id=u.id WHERE b.id=$1`,
        [booking_id],
      );
      const { rows: pr } = await req.db.query(
        `SELECT * FROM payments WHERE paystack_reference=$1`,
        [reference],
      );
      const { rows: br } = await req.db.query(
        `SELECT * FROM bookings WHERE id=$1`,
        [booking_id],
      );
      if (cr[0] && pr[0] && br[0])
        sendPaymentReceipt(cr[0], br[0], pr[0]).catch(console.error);

      return res.json({
        message: "payment verified",
        booking_id,
        gateway: "flutterwave",
      });
    }

    // ── Crypto (no active verification – redirect handled by Coinbase) ──
    if (gateway === "crypto") {
      return res.status(200).json({
        message:
          "crypto payment initiated – awaiting confirmation from Coinbase",
      });
    }

    return res
      .status(400)
      .json({ error: "invalid gateway or missing reference" });
  } catch (err) {
    console.error("[payments/verifyPayment]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 6. Flutterwave webhook ────────────────────────────────────────────
export const flutterwaveWebhook = async (req, res) => {
  const signature = req.headers["verif-hash"];
  if (!signature || signature !== FLW_SECRET_HASH) {
    return res.status(401).json({ error: "invalid signature" });
  }

  const { event, data } = req.body;
  if (event !== "charge.completed") {
    return res.sendStatus(200);
  }

  try {
    const tx_ref = data.tx_ref;
    const status = data.status;

    const { rows: paymentRows } = await req.db.query(
      `SELECT id, booking_id, status FROM payments
       WHERE paystack_reference = $1`,
      [tx_ref],
    );

    if (!paymentRows.length) {
      console.warn(`Flutterwave tx_ref not found: ${tx_ref}`);
      return res.sendStatus(200);
    }

    const payment = paymentRows[0];
    if (payment.status === "success") {
      return res.sendStatus(200);
    }

    if (status === "successful") {
      const client = await req.db.connect();
      try {
        await client.query("BEGIN");

        await client.query(
          `UPDATE payments
           SET status = 'success', paid_at = now(),
               stripe_payment_id = $1
           WHERE id = $2`,
          [data.id, payment.id],
        );

        await client.query(
          `UPDATE bookings SET status='pending',updated_at=now()
           WHERE id=$1 AND status='awaiting_payment'`,
          [payment.booking_id],
        );

        await client.query("COMMIT");

        // Notifications
        const { rows: bkN } = await req.db.query(
          `SELECT b.maid_id, b.customer_id, c.name AS customer_name, m.name AS maid_name
           FROM bookings b
           JOIN users c ON c.id = b.customer_id
           JOIN users m ON m.id = b.maid_id
           WHERE b.id = $1`,
          [payment.booking_id],
        );
        if (bkN[0]) {
          await notify(req.db, {
            userId: bkN[0].customer_id,
            type: "payment_received",
            title: "✅ Payment Successful",
            body: "Your payment was confirmed. The maid will review and accept shortly.",
            data: { booking_id: payment.booking_id },
            action_url: `/bookings/${payment.booking_id}`,
            priority: "high",
          });
          await notify(req.db, {
            userId: bkN[0].maid_id,
            type: "booking_created",
            title: "💳 New Booking",
            body: `${bkN[0].customer_name} just booked you. Check your bookings to accept.`,
            data: { booking_id: payment.booking_id },
            action_url: `/bookings/${payment.booking_id}`,
            priority: "high",
          });
        }

        // Send receipt email
        const { rows: cr } = await req.db.query(
          `SELECT u.name, u.email FROM users u JOIN bookings b ON b.customer_id=u.id WHERE b.id=$1`,
          [payment.booking_id],
        );
        const { rows: br } = await req.db.query(
          `SELECT * FROM bookings WHERE id=$1`,
          [payment.booking_id],
        );
        const { rows: pr } = await req.db.query(
          `SELECT * FROM payments WHERE id=$1`,
          [payment.id],
        );
        if (cr[0] && pr[0] && br[0]) {
          sendPaymentReceipt(cr[0], br[0], pr[0]).catch(console.error);
        }
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } else {
      await req.db.query(`UPDATE payments SET status=$1 WHERE id=$2`, [
        status === "cancelled" ? "cancelled" : "failed",
        payment.id,
      ]);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("[payments/flutterwaveWebhook]", err);
    return res.sendStatus(500);
  }
};

// ── 7. Admin approve booking ───────────────────────────────────────────
export const adminApproveBooking = async (req, res) => {
  const { booking_id } = req.params;
  try {
    const { rows: pmtRows } = await req.db.query(
      `SELECT p.*, b.status AS booking_status,
              b.maid_id, b.customer_id, b.service_date, b.address, b.duration_hours,
              c.name AS customer_name, c.email AS customer_email,
              m.name AS maid_name,     m.email AS maid_email
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN users c    ON c.id = b.customer_id
       JOIN users m    ON m.id = b.maid_id
       WHERE p.booking_id = $1 AND p.status = 'success'`,
      [booking_id],
    );
    if (!pmtRows.length)
      return res.status(402).json({ error: "no successful payment found" });

    const pmt = pmtRows[0];
    if (pmt.booking_status !== "pending") {
      return res
        .status(409)
        .json({ error: `booking is already ${pmt.booking_status}` });
    }

    const { rows } = await req.db.query(
      `UPDATE bookings SET status='confirmed',updated_at=now() WHERE id=$1 RETURNING *`,
      [booking_id],
    );
    await req.db.query(
      `INSERT INTO maid_payouts (maid_id,booking_id,payment_id,amount,currency,status)
       VALUES ($1,$2,$3,$4,$5,'escrow')`,
      [pmt.maid_id, booking_id, pmt.id, pmt.maid_payout, pmt.currency || "NGN"],
    );
    await notify(req.db, {
      userId: pmt.maid_id,
      type: "booking_approved",
      title: "✅ Booking Approved",
      body: `Your booking has been approved by admin. Payment is in escrow.`,
      data: { booking_id },
      action_url: `/bookings/${booking_id}`,
    });
    await notify(req.db, {
      userId: pmt.customer_id,
      type: "booking_approved",
      title: "✅ Booking Approved",
      body: "Your booking has been approved. The maid will be in touch soon.",
      data: { booking_id },
      action_url: `/bookings/${booking_id}`,
    });
    await req.db.query(
      `UPDATE payments SET payout_status='escrow' WHERE id=$1`,
      [pmt.id],
    );

    return res.json({
      message: "booking approved — maid notified, payout in escrow",
      booking: rows[0],
      escrow: { amount: pmt.maid_payout, currency: pmt.currency || "NGN" },
    });
  } catch (err) {
    console.error("[payments/adminApproveBooking]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 8. Admin reject booking + refund ─────────────────────────────────
export const adminRejectBooking = async (req, res) => {
  const { booking_id } = req.params;
  const { reason } = req.body;
  try {
    const { rows: pmtRows } = await req.db.query(
      `SELECT p.*, b.customer_id, c.name AS customer_name, c.email AS customer_email
       FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN users c ON c.id=b.customer_id
       WHERE p.booking_id=$1 AND p.status='success'`,
      [booking_id],
    );
    if (!pmtRows.length)
      return res.status(404).json({ error: "payment not found" });

    const pmt = pmtRows[0];
    const { rows } = await req.db.query(
      `UPDATE bookings SET status='cancelled', notes=$1, updated_at=now()
       WHERE id=$2 AND status='pending' RETURNING *`,
      [reason || "Rejected by admin", booking_id],
    );
    if (!rows.length)
      return res
        .status(404)
        .json({ error: "booking not found or not pending" });

    let refundResult = { attempted: false };
    // Flutterwave refund
    if (pmt.gateway === "flutterwave" && pmt.stripe_payment_id) {
      try {
        const r = await flutterwaveRequest(
          "POST",
          `/transactions/${pmt.stripe_payment_id}/refund`,
          { amount: pmt.amount },
        );
        refundResult = {
          attempted: true,
          gateway: "flutterwave",
          success: r.status === "success",
        };
      } catch {
        refundResult = {
          attempted: true,
          gateway: "flutterwave",
          success: false,
        };
      }
    }
    // Bank transfer refund – manual handling
    if (pmt.gateway === "bank_transfer") {
      refundResult = {
        attempted: true,
        gateway: "bank_transfer",
        success: false,
        note: "Manual refund required – contact bank",
      };
    }

    await req.db.query(`UPDATE payments SET status='refunded' WHERE id=$1`, [
      pmt.id,
    ]);
    sendBookingCancelledEmail(
      { name: pmt.customer_name, email: pmt.customer_email },
      rows[0],
      "Admin",
    ).catch(console.error);

    return res.json({
      message: "booking rejected and refund initiated",
      booking: rows[0],
      refund: refundResult,
    });
  } catch (err) {
    console.error("[payments/adminRejectBooking]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 9–16: Admin, maid, and listing functions (unchanged) ─────────────
// All functions below remain exactly as before – no changes needed.

export const adminVerifyBankTransfer = async (req, res) => {
  const { payment_id } = req.params;
  const { approved, notes } = req.body;
  try {
    const newStatus = approved ? "success" : "failed";
    const { rows } = await req.db.query(
      `UPDATE payments SET status=$1, bank_transfer_status=$2,
         paid_at=CASE WHEN $3 THEN now() ELSE NULL END, notes=$4
       WHERE id=$5 AND gateway='bank_transfer' RETURNING *`,
      [
        newStatus,
        approved ? "verified" : "rejected",
        approved,
        notes || null,
        payment_id,
      ],
    );
    if (!rows.length)
      return res.status(404).json({ error: "payment not found" });
    if (approved) {
      await req.db.query(
        `UPDATE bookings SET status='pending',updated_at=now() WHERE id=$1 AND status='awaiting_payment'`,
        [rows[0].booking_id],
      );
    }
    return res.json({
      message: approved ? "Bank transfer verified" : "Bank transfer rejected",
      payment: rows[0],
    });
  } catch (err) {
    console.error("[payments/adminVerifyBankTransfer]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const adminProcessPayout = async (req, res) => {
  const { payout_id } = req.params;
  const { payout_ref, notes } = req.body;
  try {
    const { rows: pr } = await req.db.query(
      `SELECT mp.*, b.status AS booking_status, m.name AS maid_name, m.email AS maid_email,
              mbd.bank_name, mbd.account_number, mbd.account_name
       FROM maid_payouts mp
       JOIN bookings b ON b.id=mp.booking_id
       JOIN users m ON m.id=mp.maid_id
       LEFT JOIN maid_bank_details mbd ON mbd.maid_id=mp.maid_id
       WHERE mp.id=$1 AND mp.status='escrow'`,
      [payout_id],
    );
    if (!pr.length)
      return res
        .status(404)
        .json({ error: "payout not found or not in escrow" });
    if (pr[0].booking_status !== "completed")
      return res.status(409).json({ error: "booking not completed yet" });
    const { rows } = await req.db.query(
      `UPDATE maid_payouts SET status='paid',payout_ref=$1,notes=$2,processed_by=$3,processed_at=now() WHERE id=$4 RETURNING *`,
      [payout_ref || null, notes || null, req.user.id, payout_id],
    );
    await req.db.query(
      `UPDATE payments SET payout_status='paid',payout_at=now() WHERE booking_id=$1`,
      [pr[0].booking_id],
    );
    return res.json({
      message: "Payout processed",
      payout: rows[0],
      maid: { name: pr[0].maid_name, email: pr[0].maid_email },
      bank: { name: pr[0].bank_name, account: pr[0].account_number },
    });
  } catch (err) {
    console.error("[payments/adminProcessPayout]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const adminListPayouts = async (req, res) => {
  const { status = "escrow", page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  try {
    const { rows } = await req.db.query(
      `SELECT mp.*, m.name AS maid_name, m.email AS maid_email,
              b.service_date, b.status AS booking_status, b.address,
              mbd.bank_name, mbd.account_number, mbd.account_name
       FROM maid_payouts mp
       JOIN users m ON m.id=mp.maid_id
       JOIN bookings b ON b.id=mp.booking_id
       LEFT JOIN maid_bank_details mbd ON mbd.maid_id=mp.maid_id
       WHERE mp.status=$1 ORDER BY mp.created_at DESC LIMIT $2 OFFSET $3`,
      [status, Number(limit), offset],
    );
    return res.json({ payouts: rows });
  } catch (err) {
    console.error("[payments/adminListPayouts]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const getMaidEarnings = async (req, res) => {
  try {
    const { rows: payoutRows } = await req.db.query(
      `SELECT
         currency,
         COUNT(*) FILTER (WHERE status = 'paid')   AS total_paid_count,
         COUNT(*) FILTER (WHERE status = 'escrow') AS in_escrow_count,
         COALESCE(SUM(amount) FILTER (WHERE status = 'paid'),   0) AS total_earned,
         COALESCE(SUM(amount) FILTER (WHERE status = 'escrow'), 0) AS in_escrow
       FROM maid_payouts
       WHERE maid_id = $1
       GROUP BY currency`,
      [req.user.id],
    );
    const { rows: walletRows } = await req.db.query(
      `SELECT currency, available_balance, pending_balance, total_earned
       FROM maid_wallets WHERE maid_id = $1`,
      [req.user.id],
    );
    const allCurrencies = [
      ...new Set([
        ...payoutRows.map((r) => r.currency),
        ...walletRows.map((r) => r.currency),
      ]),
    ];
    const earnings = allCurrencies.map((cur) => {
      const p = payoutRows.find((r) => r.currency === cur) || {};
      const w = walletRows.find((r) => r.currency === cur) || {};
      return {
        currency: cur,
        total_paid_count: Number(p.total_paid_count || 0),
        in_escrow_count: Number(p.in_escrow_count || 0),
        total_earned: Number(w.total_earned || p.total_earned || 0),
        in_escrow: Number(p.in_escrow || 0),
      };
    });
    return res.json({ earnings });
  } catch (err) {
    console.error("[payments/getMaidEarnings]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const saveMaidBankDetails = async (req, res) => {
  const {
    bank_name,
    account_number,
    account_name,
    bank_code,
    country = "NG",
    currency = "NGN",
  } = req.body;
  if (!bank_name || !account_number || !account_name) {
    return res.status(400).json({
      error: "bank_name, account_number and account_name are required",
    });
  }
  try {
    const { rows } = await req.db.query(
      `INSERT INTO maid_bank_details (maid_id,bank_name,account_number,account_name,bank_code,country,currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (maid_id) DO UPDATE SET bank_name=$2,account_number=$3,account_name=$4,bank_code=$5,country=$6,currency=$7,verified=false,updated_at=now()
       RETURNING id,bank_name,account_number,account_name,country,currency,verified`,
      [
        req.user.id,
        bank_name,
        account_number,
        account_name,
        bank_code || null,
        country,
        currency,
      ],
    );
    return res.json({ bank_details: rows[0] });
  } catch (err) {
    console.error("[payments/saveMaidBankDetails]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const getMaidBankDetails = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT id,bank_name,account_number,account_name,country,currency,verified FROM maid_bank_details WHERE maid_id=$1`,
      [req.user.id],
    );
    return res.json({ bank_details: rows[0] || null });
  } catch (err) {
    console.error("[payments/getMaidBankDetails]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const listPendingPayments = async (req, res) => {
  const { gateway } = req.query;
  const conditions = [`b.status='pending'`, `p.status='success'`];
  const params = [];
  if (gateway) {
    params.push(gateway);
    conditions.push(`p.gateway=$${params.length}`);
  }
  params.push(50, 0);
  try {
    const { rows } = await req.db.query(
      `SELECT DISTINCT ON (b.id) b.id AS booking_id, b.status AS booking_status, b.service_date, b.total_amount,
          b.address, b.duration_hours, b.created_at,
          c.name AS customer_name, c.email AS customer_email, m.name AS maid_name,
          p.id AS payment_id, p.status AS payment_status, p.gateway,
          p.paystack_reference, p.stripe_payment_id, p.bank_transfer_ref,
          p.bank_transfer_proof, p.platform_fee, p.maid_payout, p.paid_at,
          p.currency
   FROM bookings b
   JOIN users c ON c.id=b.customer_id JOIN users m ON m.id=b.maid_id
   JOIN payments p ON p.booking_id=b.id
   WHERE ${conditions.join(" AND ")}
   ORDER BY b.id, p.paid_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return res.json({ bookings: rows });
  } catch (err) {
    console.error("[payments/listPendingPayments]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const getPayment = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT p.* FROM payments p JOIN bookings b ON b.id=p.booking_id
       WHERE p.booking_id=$1 AND (b.customer_id=$2 OR b.maid_id=$2 OR $3='admin')`,
      [req.params.booking_id, req.user.id, req.user.role],
    );
    if (!rows.length)
      return res.status(404).json({ error: "payment not found" });
    return res.json({ payment: rows[0] });
  } catch (err) {
    console.error("[payments/getPayment]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const listCustomerPayments = async (req, res) => {
  const { currency, gateway, status, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [`b.customer_id = $1`];
  const params = [req.user.id];

  if (currency) {
    params.push(currency);
    conditions.push(`p.currency = $${params.length}`);
  }
  if (gateway) {
    params.push(gateway);
    conditions.push(`p.gateway = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`p.status = $${params.length}`);
  }

  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT p.id, p.status, p.gateway, p.currency, p.amount,
              p.platform_fee, p.maid_payout, p.paid_at, p.created_at,
              p.paystack_reference, p.stripe_payment_id, p.bank_transfer_ref,
              b.id AS booking_id, b.service_date, b.address,
              b.duration_hours, b.total_amount, b.status AS booking_status,
              m.name AS maid_name, m.avatar AS maid_avatar
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN users m    ON m.id = b.maid_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY p.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const { rows: totals } = await req.db.query(
      `SELECT p.currency,
              COUNT(*) AS count,
              COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'success'), 0) AS total_paid
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       WHERE b.customer_id = $1
       GROUP BY p.currency`,
      [req.user.id],
    );

    return res.json({ payments: rows, summary: totals });
  } catch (err) {
    console.error("[payments/listCustomerPayments]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

export const adminListBankTransfers = async (req, res) => {
  const { type } = req.query;
  const isHistory = type === "history";
  try {
    const { rows } = await req.db.query(
      `SELECT DISTINCT ON (p.id) p.id AS payment_id, p.amount, p.currency,
              p.bank_transfer_ref, p.bank_transfer_proof, p.bank_transfer_status,
              p.paid_at, p.created_at, p.notes, p.status,
              b.id AS booking_id, b.service_date, b.address, b.total_amount,
              b.duration_hours,
              c.name AS customer_name, c.email AS customer_email,
              m.name AS maid_name
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN users c ON c.id = b.customer_id
       JOIN users m ON m.id = b.maid_id
       WHERE p.gateway = 'bank_transfer'
         AND p.bank_transfer_status = ANY($1)
       ORDER BY p.id, p.created_at DESC
       LIMIT 100`,
      [
        isHistory
          ? ["verified", "rejected"]
          : ["awaiting_proof", "proof_submitted"],
      ],
    );
    return res.json({ payments: rows });
  } catch (err) {
    console.error("[payments/adminListBankTransfers]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
