import crypto from "crypto";
import Stripe from "stripe";
import {
  sendPaymentReceipt,
  sendNewBookingToMaid,
  sendBookingCancelledEmail,
} from "../utils/mailer.js";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE = "https://api.paystack.co";
const COINBASE_KEY = process.env.COINBASE_COMMERCE_API_KEY;
const PLATFORM_FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT || 10);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── Helpers ────────────────────────────────────────────────────────────

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

function calcFees(totalAmount) {
  const platformFee =
    Math.round(((totalAmount * PLATFORM_FEE_PERCENT) / 100) * 100) / 100;
  const maidPayout = Math.round((totalAmount - platformFee) * 100) / 100;
  return { platformFee, maidPayout };
}

async function fetchBookingForPayment(db, bookingId, customerId) {
  const { rows } = await db.query(
    `SELECT b.*, u.email, u.name as customer_name,
            m.name as maid_name, m.email as maid_email,
            mp.currency as maid_currency
     FROM bookings b
     JOIN users u  ON u.id  = b.customer_id
     JOIN users m  ON m.id  = b.maid_id
     LEFT JOIN maid_profiles mp ON mp.user_id = b.maid_id
     WHERE b.id = $1 AND b.customer_id = $2 AND b.status = 'awaiting_payment'`,
    [bookingId, customerId],
  );
  return rows[0] || null;
}

// ── 1. Initialize Paystack payment ─────────────────────────────────────
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

    const { platformFee, maidPayout } = calcFees(Number(booking.total_amount));
    const reference = `ds_${booking_id}_${Date.now()}`;

    const paystackRes = await paystackRequest(
      "POST",
      "/transaction/initialize",
      {
        email: booking.email,
        amount: Math.round(Number(booking.total_amount) * 100), // kobo
        currency: "NGN",
        reference,
        callback_url: `${process.env.CLIENT_URL}/payment/verify?gateway=paystack`,
        metadata: { booking_id, customer_id: req.user.id },
      },
    );

    if (!paystackRes.status) {
      return res
        .status(502)
        .json({
          error: "paystack initialization failed",
          details: paystackRes.message,
        });
    }

    const { reference: ref, access_code, authorization_url } = paystackRes.data;

    await req.db.query(
      `INSERT INTO payments
         (booking_id, customer_id, amount, currency, gateway,
          paystack_reference, paystack_access_code, platform_fee, maid_payout)
       VALUES ($1,$2,$3,'NGN','paystack',$4,$5,$6,$7)
       ON CONFLICT (paystack_reference) DO NOTHING`,
      [
        booking_id,
        req.user.id,
        booking.total_amount,
        ref,
        access_code,
        platformFee,
        maidPayout,
      ],
    );

    return res.json({
      gateway: "paystack",
      authorization_url,
      access_code,
      reference: ref,
    });
  } catch (err) {
    console.error("[payments/initializePayment]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 2. Initialize Stripe payment ───────────────────────────────────────
export const initializeStripePayment = async (req, res) => {
  const { booking_id, currency = "usd" } = req.body;
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

    const { platformFee, maidPayout } = calcFees(Number(booking.total_amount));

    // Convert amount to cents/lowest unit
    const amountInCents = Math.round(Number(booking.total_amount) * 100);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: booking.email,
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: amountInCents,
            product_data: {
              name: `Cleaning Service - ${booking.address}`,
              description: `${booking.duration_hours} hour(s) · ${booking.rate_type} rate`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.CLIENT_URL}/payment/verify?gateway=stripe&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/bookings/${booking_id}?payment=cancelled`,
      metadata: { booking_id, customer_id: req.user.id },
    });

    await req.db.query(
      `INSERT INTO payments
         (booking_id, customer_id, amount, currency, gateway,
          stripe_session_id, platform_fee, maid_payout)
       VALUES ($1,$2,$3,$4,'stripe',$5,$6,$7)`,
      [
        booking_id,
        req.user.id,
        booking.total_amount,
        currency.toUpperCase(),
        session.id,
        platformFee,
        maidPayout,
      ],
    );

    return res.json({
      gateway: "stripe",
      session_id: session.id,
      url: session.url, // redirect customer to this URL
    });
  } catch (err) {
    console.error("[payments/initializeStripePayment]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 3. Bank transfer ───────────────────────────────────────────────────
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

    const { platformFee, maidPayout } = calcFees(Number(booking.total_amount));
    const transferRef = `BT-${booking_id.slice(0, 8).toUpperCase()}-${Date.now()}`;

    await req.db.query(
      `INSERT INTO payments
         (booking_id, customer_id, amount, currency, gateway,
          bank_transfer_ref, bank_transfer_status, platform_fee, maid_payout)
       VALUES ($1,$2,$3,'NGN','bank_transfer',$4,'awaiting_proof',$5,$6)`,
      [
        booking_id,
        req.user.id,
        booking.total_amount,
        transferRef,
        platformFee,
        maidPayout,
      ],
    );

    return res.json({
      gateway: "bank_transfer",
      reference: transferRef,
      amount: booking.total_amount,
      bank_details: {
        bank_name: process.env.BANK_NAME,
        account_number: process.env.BANK_ACCOUNT_NUMBER,
        account_name: process.env.BANK_ACCOUNT_NAME,
        narration: `Deusizi Booking ${transferRef}`,
      },
      instructions:
        "Transfer the exact amount and upload your payment proof below.",
    });
  } catch (err) {
    console.error("[payments/initializeBankTransfer]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 4. Upload bank transfer proof ──────────────────────────────────────
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

    if (!rows.length) {
      return res.status(404).json({ error: "payment record not found" });
    }

    // Notify admin to verify
    const { rows: adminRows } = await req.db.query(
      `SELECT email FROM users WHERE role = 'admin' AND is_active = true`,
    );
    // (fire-and-forget admin notification handled when we build notifications controller)

    return res.json({
      message: "Payment proof submitted. Admin will verify within 24 hours.",
      payment: rows[0],
    });
  } catch (err) {
    console.error("[payments/confirmBankTransfer]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 5. Crypto payment via Coinbase Commerce ────────────────────────────
export const initializeCryptoPayment = async (req, res) => {
  const { booking_id } = req.body;
  if (!booking_id)
    return res.status(400).json({ error: "booking_id is required" });

  if (!COINBASE_KEY) {
    return res.status(503).json({ error: "crypto payments not configured" });
  }

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

    const { platformFee, maidPayout } = calcFees(Number(booking.total_amount));

    // Create charge on Coinbase Commerce
    const cbRes = await fetch("https://api.commerce.coinbase.com/charges", {
      method: "POST",
      headers: {
        "X-CC-Api-Key": COINBASE_KEY,
        "X-CC-Version": "2018-03-22",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Deusizi Sparkle Booking",
        description: `Cleaning service at ${booking.address}`,
        pricing_type: "fixed_price",
        local_price: {
          amount: String(booking.total_amount),
          currency: "USD", // Coinbase converts from USD
        },
        metadata: { booking_id, customer_id: req.user.id },
        redirect_url: `${process.env.CLIENT_URL}/payment/verify?gateway=crypto`,
        cancel_url: `${process.env.CLIENT_URL}/bookings/${booking_id}?payment=cancelled`,
      }),
    });

    const cbData = await cbRes.json();
    if (cbData.error) {
      return res
        .status(502)
        .json({
          error: "crypto payment initialization failed",
          details: cbData.error.message,
        });
    }

    const charge = cbData.data;
    const expiresAt = new Date(charge.expires_at);

    await req.db.query(
      `INSERT INTO payments
         (booking_id, customer_id, amount, currency, gateway,
          crypto_charge_id, crypto_charge_code, crypto_expires_at,
          platform_fee, maid_payout)
       VALUES ($1,$2,$3,'USD','crypto',$4,$5,$6,$7,$8)`,
      [
        booking_id,
        req.user.id,
        booking.total_amount,
        charge.id,
        charge.code,
        expiresAt,
        platformFee,
        maidPayout,
      ],
    );

    return res.json({
      gateway: "crypto",
      charge_id: charge.id,
      charge_code: charge.code,
      hosted_url: charge.hosted_url, // redirect user here
      expires_at: expiresAt,
      accepted_currencies: Object.keys(charge.addresses || {}),
    });
  } catch (err) {
    console.error("[payments/initializeCryptoPayment]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 6. Verify payment (Paystack + Stripe) ─────────────────────────────
export const verifyPayment = async (req, res) => {
  const { reference, session_id, gateway } = req.query;

  try {
    if (gateway === "stripe" && session_id) {
      const session = await stripe.checkout.sessions.retrieve(session_id);

      if (session.payment_status !== "paid") {
        return res.status(402).json({ error: "payment not completed" });
      }

      const booking_id = session.metadata?.booking_id;
      const client = await req.db.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE payments
           SET status = 'success', paid_at = now(),
               stripe_payment_id = $1
           WHERE stripe_session_id = $2 AND status != 'success'`,
          [session.payment_intent, session_id],
        );
        await client.query(
          `UPDATE bookings SET status = 'pending', updated_at = now()
           WHERE id = $1 AND status = 'awaiting_payment'`,
          [booking_id],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }

      // Send receipt
      const { rows: custRows } = await req.db.query(
        `SELECT u.name, u.email FROM users u
         JOIN bookings b ON b.customer_id = u.id
         WHERE b.id = $1`,
        [booking_id],
      );
      const { rows: pmtRows } = await req.db.query(
        `SELECT * FROM payments WHERE stripe_session_id = $1`,
        [session_id],
      );
      const { rows: bkRows } = await req.db.query(
        `SELECT * FROM bookings WHERE id = $1`,
        [booking_id],
      );
      if (custRows[0] && pmtRows[0] && bkRows[0]) {
        sendPaymentReceipt(custRows[0], bkRows[0], pmtRows[0]).catch(
          console.error,
        );
      }

      return res.json({
        message: "payment verified and awaiting admin approval",
        booking_id,
        gateway: "stripe",
      });
    }

    // ── Paystack verify ──────────────────────────────────────────
    if (!reference)
      return res.status(400).json({ error: "reference is required" });

    const paystackRes = await paystackRequest(
      "GET",
      `/transaction/verify/${reference}`,
    );

    if (!paystackRes.status || paystackRes.data.status !== "success") {
      await req.db.query(
        `UPDATE payments SET status = 'failed' WHERE paystack_reference = $1`,
        [reference],
      );
      return res.status(402).json({ error: "payment not successful" });
    }

    const booking_id = paystackRes.data.metadata?.booking_id;
    const client = await req.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE payments SET status = 'success', paid_at = now()
         WHERE paystack_reference = $1`,
        [reference],
      );
      await client.query(
        `UPDATE bookings SET status = 'pending', updated_at = now()
         WHERE id = $1 AND status = 'awaiting_payment'`,
        [booking_id],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    // Send receipt
    const { rows: custRows } = await req.db.query(
      `SELECT u.name, u.email FROM users u
       JOIN bookings b ON b.customer_id = u.id
       WHERE b.id = $1`,
      [booking_id],
    );
    const { rows: pmtRows } = await req.db.query(
      `SELECT * FROM payments WHERE paystack_reference = $1`,
      [reference],
    );
    const { rows: bkRows } = await req.db.query(
      `SELECT * FROM bookings WHERE id = $1`,
      [booking_id],
    );
    if (custRows[0] && pmtRows[0] && bkRows[0]) {
      sendPaymentReceipt(custRows[0], bkRows[0], pmtRows[0]).catch(
        console.error,
      );
    }

    return res.json({
      message: "payment verified and awaiting admin approval",
      booking_id,
      gateway: "paystack",
    });
  } catch (err) {
    console.error("[payments/verifyPayment]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 7. Paystack webhook ────────────────────────────────────────────────
export const webhook = async (req, res) => {
  const signature = req.headers["x-paystack-signature"];
  const hash = crypto
    .createHmac("sha512", PAYSTACK_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash !== signature)
    return res.status(401).json({ error: "invalid signature" });

  const { event, data } = req.body;

  try {
    if (event === "charge.success") {
      const client = await req.db.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE payments SET status = 'success', paid_at = now()
           WHERE paystack_reference = $1 AND status != 'success'`,
          [data.reference],
        );
        await client.query(
          `UPDATE bookings SET status = 'pending', updated_at = now()
           WHERE id = $1 AND status = 'awaiting_payment'`,
          [data.metadata?.booking_id],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }

    if (event === "refund.processed") {
      await req.db.query(
        `UPDATE payments SET status = 'refunded' WHERE paystack_reference = $1`,
        [data.transaction_reference],
      );
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("[payments/webhook]", err);
    return res.sendStatus(500);
  }
};

// ── 8. Stripe webhook ──────────────────────────────────────────────────
export const stripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    // req.body must be raw buffer for Stripe signature verification
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    return res
      .status(400)
      .json({ error: `Stripe webhook error: ${err.message}` });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const booking_id = session.metadata?.booking_id;

      if (session.payment_status === "paid") {
        const client = await req.db.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            `UPDATE payments
             SET status = 'success', paid_at = now(), stripe_payment_id = $1
             WHERE stripe_session_id = $2 AND status != 'success'`,
            [session.payment_intent, session.id],
          );
          await client.query(
            `UPDATE bookings SET status = 'pending', updated_at = now()
             WHERE id = $1 AND status = 'awaiting_payment'`,
            [booking_id],
          );
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      }
    }

    if (event.type === "charge.refunded") {
      await req.db.query(
        `UPDATE payments SET status = 'refunded'
         WHERE stripe_payment_id = $1`,
        [event.data.object.payment_intent],
      );
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("[payments/stripeWebhook]", err);
    return res.sendStatus(500);
  }
};

// ── 9. Admin approve booking ───────────────────────────────────────────
export const adminApproveBooking = async (req, res) => {
  const { booking_id } = req.params;

  try {
    const { rows: paymentRows } = await req.db.query(
      `SELECT p.*, b.status as booking_status,
              b.maid_id, b.customer_id, b.service_date, b.address, b.duration_hours,
              c.name as customer_name, c.email as customer_email,
              m.name as maid_name, m.email as maid_email
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN users c ON c.id = b.customer_id
       JOIN users m ON m.id = b.maid_id
       WHERE p.booking_id = $1 AND p.status = 'success'`,
      [booking_id],
    );

    if (!paymentRows.length) {
      return res.status(402).json({ error: "no successful payment found" });
    }

    const pmt = paymentRows[0];

    if (pmt.booking_status !== "pending") {
      return res
        .status(409)
        .json({ error: `booking is already ${pmt.booking_status}` });
    }

    // Approve booking
    const { rows } = await req.db.query(
      `UPDATE bookings SET status = 'confirmed', updated_at = now()
       WHERE id = $1 RETURNING *`,
      [booking_id],
    );

    // Create maid payout record (held in escrow until job complete)
    await req.db.query(
      `INSERT INTO maid_payouts
         (maid_id, booking_id, payment_id, amount, currency, status)
       VALUES ($1, $2, $3, $4, $5, 'escrow')`,
      [pmt.maid_id, booking_id, pmt.id, pmt.maid_payout, pmt.currency || "NGN"],
    );

    // Update platform fee on payment record
    await req.db.query(
      `UPDATE payments SET payout_status = 'escrow' WHERE id = $1`,
      [pmt.id],
    );

    // Notify both parties
    const booking = rows[0];
    sendBookingConfirmation(
      { name: pmt.customer_name, email: pmt.customer_email },
      booking,
      { name: pmt.maid_name },
    ).catch(console.error);

    sendNewBookingToMaid(
      { name: pmt.maid_name, email: pmt.maid_email },
      booking,
      { name: pmt.customer_name },
    ).catch(console.error);

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

// ── 10. Admin reject booking + refund ─────────────────────────────────
export const adminRejectBooking = async (req, res) => {
  const { booking_id } = req.params;
  const { reason } = req.body;

  try {
    const { rows: pmtRows } = await req.db.query(
      `SELECT p.*, b.customer_id,
              c.name as customer_name, c.email as customer_email
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN users c ON c.id = b.customer_id
       WHERE p.booking_id = $1 AND p.status = 'success'`,
      [booking_id],
    );

    if (!pmtRows.length)
      return res.status(404).json({ error: "payment not found" });

    const pmt = pmtRows[0];

    // Cancel booking
    const { rows } = await req.db.query(
      `UPDATE bookings
       SET status = 'cancelled', cancelled_by = 'admin',
           cancelled_reason = $1, cancelled_at = now(), updated_at = now()
       WHERE id = $2 AND status = 'pending' RETURNING *`,
      [reason || "Rejected by admin", booking_id],
    );

    if (!rows.length)
      return res
        .status(404)
        .json({ error: "booking not found or not pending" });

    // Attempt actual refund via gateway
    let refundResult = { attempted: false };

    if (pmt.gateway === "paystack" && pmt.paystack_reference) {
      try {
        const refundRes = await paystackRequest("POST", "/refund", {
          transaction: pmt.paystack_reference,
          amount: Math.round(Number(pmt.amount) * 100),
        });
        refundResult = {
          attempted: true,
          gateway: "paystack",
          success: refundRes.status,
        };
      } catch {
        refundResult = { attempted: true, gateway: "paystack", success: false };
      }
    }

    if (pmt.gateway === "stripe" && pmt.stripe_payment_id) {
      try {
        const refund = await stripe.refunds.create({
          payment_intent: pmt.stripe_payment_id,
        });
        refundResult = {
          attempted: true,
          gateway: "stripe",
          success: refund.status === "succeeded",
        };
      } catch {
        refundResult = { attempted: true, gateway: "stripe", success: false };
      }
    }

    await req.db.query(
      `UPDATE payments SET status = 'refunded' WHERE id = $1`,
      [pmt.id],
    );

    // Notify customer
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

// ── 11. Admin verify bank transfer ────────────────────────────────────
export const adminVerifyBankTransfer = async (req, res) => {
  const { payment_id } = req.params;
  const { approved, notes } = req.body;

  try {
    const newStatus = approved ? "success" : "failed";

    const { rows: pmtRows } = await req.db.query(
      `UPDATE payments
       SET status = $1, bank_transfer_status = $2, paid_at = CASE WHEN $3 THEN now() ELSE NULL END,
           notes = $4
       WHERE id = $5 AND gateway = 'bank_transfer'
       RETURNING *`,
      [
        newStatus,
        approved ? "verified" : "rejected",
        approved,
        notes || null,
        payment_id,
      ],
    );

    if (!pmtRows.length)
      return res.status(404).json({ error: "payment not found" });

    if (approved) {
      await req.db.query(
        `UPDATE bookings SET status = 'pending', updated_at = now()
         WHERE id = $1 AND status = 'awaiting_payment'`,
        [pmtRows[0].booking_id],
      );
    }

    return res.json({
      message: approved ? "Bank transfer verified" : "Bank transfer rejected",
      payment: pmtRows[0],
    });
  } catch (err) {
    console.error("[payments/adminVerifyBankTransfer]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 12. Admin process maid payout ─────────────────────────────────────
export const adminProcessPayout = async (req, res) => {
  const { payout_id } = req.params;
  const { payout_ref, notes } = req.body;

  try {
    // Verify booking is completed before releasing escrow
    const { rows: payoutRows } = await req.db.query(
      `SELECT mp.*, b.status as booking_status,
              m.name as maid_name, m.email as maid_email,
              mbd.bank_name, mbd.account_number, mbd.account_name
       FROM maid_payouts mp
       JOIN bookings b ON b.id = mp.booking_id
       JOIN users m    ON m.id = mp.maid_id
       LEFT JOIN maid_bank_details mbd ON mbd.maid_id = mp.maid_id
       WHERE mp.id = $1 AND mp.status = 'escrow'`,
      [payout_id],
    );

    if (!payoutRows.length) {
      return res
        .status(404)
        .json({ error: "payout not found or not in escrow" });
    }

    const payout = payoutRows[0];

    if (payout.booking_status !== "completed") {
      return res.status(409).json({
        error: "cannot release escrow — booking not completed yet",
      });
    }

    const { rows } = await req.db.query(
      `UPDATE maid_payouts
       SET status = 'paid', payout_ref = $1, notes = $2,
           processed_by = $3, processed_at = now()
       WHERE id = $4 RETURNING *`,
      [payout_ref || null, notes || null, req.user.id, payout_id],
    );

    await req.db.query(
      `UPDATE payments SET payout_status = 'paid', payout_at = now()
       WHERE booking_id = $1`,
      [payout.booking_id],
    );

    return res.json({
      message: "Payout processed — escrow released to maid",
      payout: rows[0],
      maid: { name: payout.maid_name, email: payout.maid_email },
      bank: { name: payout.bank_name, account: payout.account_number },
    });
  } catch (err) {
    console.error("[payments/adminProcessPayout]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 13. Admin list payouts ────────────────────────────────────────────
export const adminListPayouts = async (req, res) => {
  const { status = "escrow", page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  try {
    const { rows } = await req.db.query(
      `SELECT mp.*,
              m.name as maid_name, m.email as maid_email,
              b.service_date, b.status as booking_status, b.address,
              mbd.bank_name, mbd.account_number, mbd.account_name
       FROM maid_payouts mp
       JOIN users m ON m.id = mp.maid_id
       JOIN bookings b ON b.id = mp.booking_id
       LEFT JOIN maid_bank_details mbd ON mbd.maid_id = mp.maid_id
       WHERE mp.status = $1
       ORDER BY mp.created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, Number(limit), offset],
    );
    return res.json({ payouts: rows });
  } catch (err) {
    console.error("[payments/adminListPayouts]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 14. Maid earnings summary ─────────────────────────────────────────
export const getMaidEarnings = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'paid')    AS total_paid_count,
         COUNT(*) FILTER (WHERE status = 'escrow')  AS in_escrow_count,
         COALESCE(SUM(amount) FILTER (WHERE status = 'paid'),   0) AS total_earned,
         COALESCE(SUM(amount) FILTER (WHERE status = 'escrow'), 0) AS in_escrow,
         currency
       FROM maid_payouts
       WHERE maid_id = $1
       GROUP BY currency`,
      [req.user.id],
    );
    return res.json({ earnings: rows });
  } catch (err) {
    console.error("[payments/getMaidEarnings]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 15. Save maid bank details ────────────────────────────────────────
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
    return res
      .status(400)
      .json({
        error: "bank_name, account_number and account_name are required",
      });
  }

  try {
    const { rows } = await req.db.query(
      `INSERT INTO maid_bank_details
         (maid_id, bank_name, account_number, account_name, bank_code, country, currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (maid_id) DO UPDATE
       SET bank_name = $2, account_number = $3, account_name = $4,
           bank_code = $5, country = $6, currency = $7,
           verified = false, updated_at = now()
       RETURNING id, bank_name, account_number, account_name, country, currency, verified`,
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

// ── 16. Get maid bank details ─────────────────────────────────────────
export const getMaidBankDetails = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT id, bank_name, account_number, account_name,
              country, currency, verified
       FROM maid_bank_details WHERE maid_id = $1`,
      [req.user.id],
    );
    return res.json({ bank_details: rows[0] || null });
  } catch (err) {
    console.error("[payments/getMaidBankDetails]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 17. List pending payments (admin) ─────────────────────────────────
export const listPendingPayments = async (req, res) => {
  const { gateway } = req.query;

  const conditions = [`b.status = 'pending'`, `p.status = 'success'`];
  const params = [];

  if (gateway) {
    params.push(gateway);
    conditions.push(`p.gateway = $${params.length}`);
  }

  params.push(50, 0); // limit, offset

  try {
    const { rows } = await req.db.query(
      `SELECT b.id as booking_id, b.status as booking_status,
              b.service_date, b.total_amount, b.address, b.duration_hours,
              b.created_at, b.rate_type,
              c.name as customer_name, c.email as customer_email,
              m.name as maid_name,
              p.id as payment_id, p.status as payment_status,
              p.gateway, p.paystack_reference, p.stripe_payment_id,
              p.bank_transfer_ref, p.bank_transfer_proof,
              p.platform_fee, p.maid_payout, p.paid_at
       FROM bookings b
       JOIN users c ON c.id = b.customer_id
       JOIN users m ON m.id = b.maid_id
       JOIN payments p ON p.booking_id = b.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY p.paid_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return res.json({ bookings: rows });
  } catch (err) {
    console.error("[payments/listPendingPayments]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── 18. Get payment for a booking ─────────────────────────────────────
export const getPayment = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT p.* FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       WHERE p.booking_id = $1
         AND (b.customer_id = $2 OR b.maid_id = $2 OR $3 = 'admin')`,
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
