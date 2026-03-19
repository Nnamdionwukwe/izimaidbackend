import crypto from "crypto";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE = "https://api.paystack.co";

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

// ── Initialize payment ─────────────────────────────────────────
export const initializePayment = async (req, res) => {
  const { booking_id } = req.body;
  if (!booking_id)
    return res.status(400).json({ error: "booking_id is required" });

  try {
    const { rows: bookingRows } = await req.db.query(
      `SELECT b.*, u.email FROM bookings b
       JOIN users u ON u.id = b.customer_id
       WHERE b.id = $1 AND b.customer_id = $2 AND b.status = 'awaiting_payment'`,
      [booking_id, req.user.id],
    );

    if (!bookingRows.length)
      return res
        .status(404)
        .json({ error: "booking not found or already paid" });

    const booking = bookingRows[0];

    const { rows: existing } = await req.db.query(
      `SELECT id FROM payments WHERE booking_id = $1 AND status = 'success'`,
      [booking_id],
    );
    if (existing.length)
      return res.status(409).json({ error: "booking already paid" });

    const paystackRes = await paystackRequest(
      "POST",
      "/transaction/initialize",
      {
        email: booking.email,
        amount: Math.round(Number(booking.total_amount) * 100),
        currency: "NGN",
        reference: `izimaid_${booking_id}_${Date.now()}`,
        callback_url: `${process.env.FRONTEND_URL}/payment/verify`,
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

    const { reference, access_code, authorization_url } = paystackRes.data;

    await req.db.query(
      `INSERT INTO payments (booking_id, customer_id, amount, paystack_reference, paystack_access_code)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (paystack_reference) DO NOTHING`,
      [booking_id, req.user.id, booking.total_amount, reference, access_code],
    );

    return res.json({ authorization_url, access_code, reference });
  } catch (err) {
    console.error("[payments.controller/initializePayment]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Verify payment (called after Paystack redirect) ────────────
export const verifyPayment = async (req, res) => {
  const { reference } = req.params;

  try {
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
        `UPDATE payments SET status = 'success', paid_at = NOW() WHERE paystack_reference = $1`,
        [reference],
      );
      // Move to 'pending' — now visible to admin for approval
      await client.query(
        `UPDATE bookings SET status = 'pending', updated_at = NOW()
         WHERE id = $1 AND status = 'awaiting_payment'`,
        [booking_id],
      );
      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }

    return res.json({
      message: "payment verified and awaiting admin approval",
      booking_id,
    });
  } catch (err) {
    console.error("[payments.controller/verifyPayment]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Webhook (Paystack server-to-server) ────────────────────────
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
          `UPDATE payments SET status = 'success', paid_at = NOW()
           WHERE paystack_reference = $1 AND status != 'success'`,
          [data.reference],
        );
        // Webhook also moves to pending for admin approval
        await client.query(
          `UPDATE bookings SET status = 'pending', updated_at = NOW()
           WHERE id = $1 AND status = 'awaiting_payment'`,
          [data.metadata?.booking_id],
        );
        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK");
        throw txErr;
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
    console.error("[payments.controller/webhook]", err);
    return res.sendStatus(500);
  }
};

// ── Admin approve booking ──────────────────────────────────────
export const adminApproveBooking = async (req, res) => {
  const { booking_id } = req.params;

  try {
    // Verify payment exists and is successful
    const { rows: paymentRows } = await req.db.query(
      `SELECT p.*, b.status as booking_status FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       WHERE p.booking_id = $1 AND p.status = 'success'`,
      [booking_id],
    );

    if (!paymentRows.length) {
      return res
        .status(402)
        .json({ error: "no successful payment found for this booking" });
    }

    if (paymentRows[0].booking_status !== "pending") {
      return res
        .status(409)
        .json({ error: `booking is already ${paymentRows[0].booking_status}` });
    }

    // Approve — move to confirmed so maid can see it
    const { rows } = await req.db.query(
      `UPDATE bookings SET status = 'confirmed', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [booking_id],
    );

    return res.json({
      message: "booking approved and sent to maid",
      booking: rows[0],
    });
  } catch (err) {
    console.error("[payments.controller/adminApproveBooking]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Admin reject booking (refund manually) ─────────────────────
export const adminRejectBooking = async (req, res) => {
  const { booking_id } = req.params;
  const { reason } = req.body;

  try {
    const { rows } = await req.db.query(
      `UPDATE bookings SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [booking_id],
    );

    if (!rows.length)
      return res
        .status(404)
        .json({ error: "booking not found or not pending" });

    // Note: actual Paystack refund would be initiated here
    // For now we mark payment as refunded
    await req.db.query(
      `UPDATE payments SET status = 'refunded' WHERE booking_id = $1`,
      [booking_id],
    );

    return res.json({
      message: "booking rejected",
      booking: rows[0],
      note: "process refund via Paystack dashboard",
    });
  } catch (err) {
    console.error("[payments.controller/adminRejectBooking]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── List pending payments (admin) ──────────────────────────────
export const listPendingPayments = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT b.id as booking_id, b.status as booking_status,
              b.service_date, b.total_amount, b.address,
              b.duration_hours, b.created_at,
              c.name as customer_name, c.email as customer_email,
              m.name as maid_name,
              p.status as payment_status, p.paystack_reference, p.paid_at
       FROM bookings b
       JOIN users c ON c.id = b.customer_id
       JOIN users m ON m.id = b.maid_id
       LEFT JOIN payments p ON p.booking_id = b.id
       WHERE b.status = 'pending' AND p.status = 'success'
       ORDER BY p.paid_at DESC`,
    );
    return res.json({ bookings: rows });
  } catch (err) {
    console.error("[payments.controller/listPendingPayments]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Get payment for a booking ──────────────────────────────────
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
    console.error("[payments.controller/getPayment]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
