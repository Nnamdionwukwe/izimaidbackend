// src/controllers/withdrawals.controller.js
import {
  sendWithdrawalRequestedEmail,
  sendWithdrawalStatusEmail,
  sendWithdrawalAdminAlertEmail,
} from "../utils/mailer.js";
import { notify, notifyAdmins } from "../utils/notify.js";
import crypto from "crypto";

async function checkTransactionPin(db, userId, pins, ip) {
  const { rows } = await db.query(
    `SELECT transaction_pin_hash, pin_failed_attempts, pin_locked_until
     FROM users WHERE id = $1`,
    [userId],
  );

  if (!rows.length) throw { status: 404, message: "user not found" };

  const user = rows[0];

  if (!user.transaction_pin_hash) {
    throw {
      status: 400,
      message:
        "transaction PIN not set. Please set a PIN in Settings before withdrawing.",
      code: "PIN_NOT_SET",
    };
  }

  if (user.pin_locked_until && new Date(user.pin_locked_until) > new Date()) {
    const mins = Math.ceil(
      (new Date(user.pin_locked_until) - Date.now()) / 60000,
    );
    throw {
      status: 429,
      message: `PIN locked. Try again in ${mins} minute(s).`,
      locked: true,
    };
  }

  const [salt, hash] = user.transaction_pin_hash.split(":");
  const valid = await new Promise((resolve, reject) => {
    crypto.scrypt(pin, salt, 32, (err, derived) => {
      if (err) reject(err);
      else resolve(derived.toString("hex") === hash);
    });
  });

  // Log attempt
  await db.query(
    `INSERT INTO pin_attempts (user_id, success, ip_address) VALUES ($1, $2, $3)`,
    [userId, valid, ip || "unknown"],
  );

  if (!valid) {
    const newAttempts = (user.pin_failed_attempts || 0) + 1;
    const shouldLock = newAttempts >= 5;
    await db.query(
      `UPDATE users SET pin_failed_attempts = $1, pin_locked_until = $2 WHERE id = $3`,
      [
        shouldLock ? 0 : newAttempts,
        shouldLock ? new Date(Date.now() + 30 * 60000) : null,
        userId,
      ],
    );
    const left = 5 - newAttempts;
    throw {
      status: 401,
      message: shouldLock
        ? "Too many failed attempts. PIN locked for 30 minutes."
        : `Incorrect PIN. ${left} attempt(s) remaining.`,
      attempts_left: left,
      locked: shouldLock,
    };
  }

  // Reset on success
  await db.query(
    `UPDATE users SET pin_failed_attempts = 0, pin_locked_until = null WHERE id = $1`,
    [userId],
  );
}

// ── Fee calculator ────────────────────────────────────────────────────
function calcWithdrawalFee(amount, currency, method) {
  // Crypto and wire have different fee structures
  if (method === "crypto") return 0; // gas fee paid by network
  if (method === "wire_transfer") {
    // Flat $15 equivalent regardless of amount
    const wireFlat = { NGN: 12000, USD: 15, GBP: 12, EUR: 14, KES: 2000 };
    return wireFlat[currency] || 15;
  }
  if (method === "paypal") {
    // PayPal charges ~2% — we absorb some, charge flat
    const paypalFlat = { NGN: 500, USD: 2, GBP: 1.5, EUR: 1.8 };
    return paypalFlat[currency] || 2;
  }
  if (method === "wise") {
    // Wise is cheapest — flat small fee
    const wiseFlat = { NGN: 250, USD: 1, GBP: 0.8, EUR: 0.9 };
    return wiseFlat[currency] || 1;
  }

  // Local bank / mobile money / Paystack Transfer — tiered by amount
  const ngnEquivalent = toNGN(amount, currency);
  const t1 = Number(process.env.WITHDRAWAL_FEE_TIER1 || 200);
  const t2 = Number(process.env.WITHDRAWAL_FEE_TIER2 || 350);
  const t3 = Number(process.env.WITHDRAWAL_FEE_TIER3 || 500);
  const t4 = Number(process.env.WITHDRAWAL_FEE_TIER4 || 750);

  let feeNGN;
  if (ngnEquivalent < 10000) feeNGN = t1;
  else if (ngnEquivalent < 50000) feeNGN = t2;
  else if (ngnEquivalent < 200000) feeNGN = t3;
  else feeNGN = t4;

  // Convert fee back to requested currency
  return fromNGN(feeNGN, currency);
}

// Rough conversion rates — in production replace with live FX API
function toNGN(amount, currency) {
  const rates = {
    NGN: 1,
    USD: 1600,
    GBP: 2000,
    EUR: 1750,
    KES: 12,
    GHS: 110,
    ZAR: 88,
    CAD: 1180,
    AUD: 1040,
  };
  return amount * (rates[currency] || 1);
}
function fromNGN(amountNGN, currency) {
  const rates = {
    NGN: 1,
    USD: 1600,
    GBP: 2000,
    EUR: 1750,
    KES: 12,
    GHS: 110,
    ZAR: 88,
    CAD: 1180,
    AUD: 1040,
  };
  return Math.round((amountNGN / (rates[currency] || 1)) * 100) / 100;
}

// ── Ensure wallet exists ──────────────────────────────────────────────
async function ensureWallet(db, maidId, currency = "NGN") {
  await db.query(
    `INSERT INTO maid_wallets (maid_id, currency)
     VALUES ($1, $2) ON CONFLICT (maid_id) DO NOTHING`,
    [maidId, currency],
  );
  const { rows } = await db.query(
    `SELECT * FROM maid_wallets WHERE maid_id = $1`,
    [maidId],
  );
  return rows[0];
}

// ── Credit wallet (called when payout is released from escrow) ────────
export async function creditWallet(
  db,
  maidId,
  amount,
  currency,
  sourceId,
  description,
) {
  const wallet = await ensureWallet(db, maidId, currency);

  const newAvailable = Number(wallet.available) + Number(amount);
  const newTotalEarned = Number(wallet.total_earned) + Number(amount);

  await db.query(
    `UPDATE maid_wallets
     SET available = $1, total_earned = $2, updated_at = now()
     WHERE maid_id = $3`,
    [newAvailable, newTotalEarned, maidId],
  );

  await db.query(
    `INSERT INTO wallet_transactions
       (maid_id, type, amount, currency, source, source_id,
        balance_before, balance_after, description)
     VALUES ($1,'credit',$2,$3,'booking_payout',$4,$5,$6,$7)`,
    [
      maidId,
      amount,
      currency,
      sourceId,
      wallet.available,
      newAvailable,
      description,
    ],
  );
}

// ── Get wallet balance ────────────────────────────────────────────────
export const getWallet = async (req, res) => {
  try {
    const wallet = await ensureWallet(req.db, req.user.id);

    // Also get recent transactions
    const { rows: txns } = await req.db.query(
      `SELECT * FROM wallet_transactions
       WHERE maid_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [req.user.id],
    );

    return res.json({ wallet, recent_transactions: txns });
  } catch (err) {
    console.error("[withdrawals/getWallet]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Request withdrawal ─────────────────────────────────────────────────
export const requestWithdrawal = async (req, res) => {
  const {
    amount,
    currency = "NGN",
    method, // 'bank_transfer','wire_transfer','mobile_money','crypto','paypal','wise','flutterwave'

    // Bank transfer (local)
    bank_name,
    account_number,
    account_name,
    bank_code,
    bank_country,

    // Wire (SWIFT)
    swift_code,
    iban,
    bank_address,

    // Mobile money
    mobile_provider,
    mobile_number,
    mobile_country,

    // Crypto
    crypto_currency,
    crypto_address,
    crypto_network,

    // PayPal
    paypal_email,

    // Wise
    wise_email,

    // Flutterwave
    flw_account_bank,
    flw_account_number,

    notes,
  } = req.body;

  const validMethods = [
    "bank_transfer",
    "wire_transfer",
    "mobile_money",
    "crypto",
    "paypal",
    "wise",
    "flutterwave",
  ];

  if (!amount || !method) {
    return res.status(400).json({ error: "amount and method are required" });
  }
  if (!validMethods.includes(method)) {
    return res
      .status(400)
      .json({ error: `method must be one of: ${validMethods.join(", ")}` });
  }

  const minNGN = Number(process.env.WITHDRAWAL_MIN_NGN || 2000);
  if (toNGN(Number(amount), currency) < minNGN) {
    return res.status(400).json({
      error: `minimum withdrawal is ₦${minNGN.toLocaleString()} equivalent`,
    });
  }

  // Validate method-specific required fields
  const methodValidation = {
    bank_transfer: () => bank_name && account_number && account_name,
    wire_transfer: () => (swift_code || iban) && account_name,
    mobile_money: () => mobile_provider && mobile_number && mobile_country,
    crypto: () => crypto_currency && crypto_address && crypto_network,
    paypal: () => paypal_email,
    wise: () => wise_email,
    flutterwave: () => flw_account_bank && flw_account_number,
  };

  if (!methodValidation[method]?.()) {
    return res
      .status(400)
      .json({ error: `missing required fields for ${method}` });
  }

  try {
    const wallet = await ensureWallet(req.db, req.user.id);

    if (Number(wallet.available) < Number(amount)) {
      return res.status(400).json({
        error: "insufficient balance",
        available: wallet.available,
        requested: amount,
      });
    }

    // Check no pending withdrawal already
    const { rows: pending } = await req.db.query(
      `SELECT id FROM withdrawals
       WHERE maid_id = $1 AND status IN ('pending','processing')`,
      [req.user.id],
    );
    if (pending.length) {
      return res.status(409).json({
        error:
          "you already have a pending withdrawal — wait for it to complete",
      });
    }

    const fee = calcWithdrawalFee(Number(amount), currency, method);
    const netAmount = Math.max(0, Number(amount) - fee);

    // Deduct from wallet immediately (hold in pending)
    const newAvailable = Number(wallet.available) - Number(amount);
    const newPending = Number(wallet.pending) + Number(amount);

    await req.db.query(
      `UPDATE maid_wallets
       SET available = $1, pending = $2, updated_at = now()
       WHERE maid_id = $3`,
      [newAvailable, newPending, req.user.id],
    );

    // Create withdrawal record
    const { rows } = await req.db.query(
      `INSERT INTO withdrawals (
        maid_id, amount, currency, method, status,
        bank_name, account_number, account_name, bank_code, bank_country,
        swift_code, iban, bank_address,
        mobile_provider, mobile_number, mobile_country,
        crypto_currency, crypto_address, crypto_network,
        paypal_email, wise_email,
        fee, net_amount, notes
      ) VALUES (
        $1,$2,$3,$4,'pending',
        $5,$6,$7,$8,$9,
        $10,$11,$12,
        $13,$14,$15,
        $16,$17,$18,
        $19,$20,
        $21,$22,$23
      ) RETURNING *`,
      [
        req.user.id,
        amount,
        currency,
        method,
        bank_name || null,
        account_number || null,
        account_name || null,
        bank_code || null,
        bank_country || null,
        swift_code || null,
        iban || null,
        bank_address || null,
        mobile_provider || null,
        mobile_number || null,
        mobile_country || null,
        crypto_currency || null,
        crypto_address || null,
        crypto_network || null,
        paypal_email || null,
        wise_email || null,
        fee,
        netAmount,
        notes || null,
      ],
    );

    // FIND in requestWithdrawal — fetch maid name from DB first:
    // ADD this BEFORE the notify() call:
    const { rows: maidInfo } = await req.db.query(
      `SELECT name, email FROM users WHERE id = $1`,
      [req.user.id],
    );
    const maidName = maidInfo[0]?.name || "Maid";
    const maidEmail = maidInfo[0]?.email || req.user.email;

    // THEN replace the notify call:
    await notify(req.db, {
      userId: req.user.id,
      type: "withdrawal_requested",
      title: "Withdrawal request submitted",
      body: `Your withdrawal of ${currency} ${Number(amount).toLocaleString()} via ${method.replace(/_/g, " ")} is being reviewed.`,
      data: { withdrawal_id: rows[0].id, amount, currency, method },
      sendMail: () =>
        sendWithdrawalRequestedEmail(
          { name: maidName, email: maidEmail },
          rows[0],
        ),
    });

    // In-app + email — all admins
    const { rows: admins } = await req.db.query(
      `SELECT id, name, email FROM users WHERE role = 'admin' AND is_active = true`,
    );
    await notifyAdmins(req.db, {
      type: "withdrawal_admin_alert",
      title: "New withdrawal request",
      body: `A maid has requested a withdrawal of ${currency} ${Number(amount).toLocaleString()} via ${method.replace(/_/g, " ")}.`,
      data: { withdrawal_id: rows[0].id },
    });
    // Email admins
    sendWithdrawalAdminAlertEmail(
      admins,
      { name: maidName, email: maidEmail }, // ← correct
      rows[0],
    ).catch(console.error);

    // Log wallet transaction
    await req.db.query(
      `INSERT INTO wallet_transactions
         (maid_id, type, amount, currency, source, source_id,
          balance_before, balance_after, description)
       VALUES ($1,'debit',$2,$3,'withdrawal',$4,$5,$6,$7)`,
      [
        req.user.id,
        amount,
        currency,
        rows[0].id,
        wallet.available,
        newAvailable,
        `Withdrawal request via ${method}`,
      ],
    );

    return res.status(201).json({
      message: "Withdrawal request submitted. Processing within 24 hours.",
      withdrawal: rows[0],
      fee,
      net_amount: netAmount,
    });
  } catch (err) {
    console.error("[withdrawals/requestWithdrawal]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Get own withdrawals ────────────────────────────────────────────────
export const getMyWithdrawals = async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const params = [req.user.id];
  let statusFilter = "";

  if (status) {
    params.push(status);
    statusFilter = `AND status = $${params.length}`;
  }

  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT id, amount, currency, method, status, fee, net_amount,
              crypto_currency, crypto_address, crypto_network,
              mobile_provider, mobile_number,
              bank_name, account_number,
              paypal_email, wise_email,
              gateway_ref, failure_reason, notes,
              created_at, updated_at
       FROM withdrawals
       WHERE maid_id = $1 ${statusFilter}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return res.json({ withdrawals: rows });
  } catch (err) {
    console.error("[withdrawals/getMyWithdrawals]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Cancel withdrawal (only if still pending) ─────────────────────────
export const cancelWithdrawal = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `UPDATE withdrawals SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND maid_id = $2 AND status = 'pending'
       RETURNING *`,
      [req.params.id, req.user.id],
    );

    if (!rows.length) {
      return res
        .status(404)
        .json({ error: "withdrawal not found or already processing" });
    }

    // Refund amount back to available balance
    const wallet = await ensureWallet(req.db, req.user.id);
    const refundAmount = Number(rows[0].amount);

    await req.db.query(
      `UPDATE maid_wallets
       SET available = available + $1,
           pending   = GREATEST(0, pending - $1),
           updated_at = now()
       WHERE maid_id = $2`,
      [refundAmount, req.user.id],
    );

    // Log reversal
    await req.db.query(
      `INSERT INTO wallet_transactions
         (maid_id, type, amount, currency, source, source_id,
          balance_before, balance_after, description)
       VALUES ($1,'reversal',$2,$3,'withdrawal',$4,$5,$6,$7)`,
      [
        req.user.id,
        refundAmount,
        rows[0].currency,
        rows[0].id,
        wallet.available,
        Number(wallet.available) + refundAmount,
        "Withdrawal cancelled by maid",
      ],
    );

    return res.json({
      message: "Withdrawal cancelled. Amount returned to wallet.",
      withdrawal: rows[0],
    });
  } catch (err) {
    console.error("[withdrawals/cancelWithdrawal]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── ADMIN: List all withdrawals ────────────────────────────────────────
export const adminListWithdrawals = async (req, res) => {
  const { status = "pending", method, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`w.status = $${params.length}`);
  }
  if (method) {
    params.push(method);
    conditions.push(`w.method = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT w.*,
              u.name as maid_name, u.email as maid_email,
              u.phone as maid_phone
       FROM withdrawals w
       JOIN users u ON u.id = w.maid_id
       ${where}
       ORDER BY w.created_at ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const { rows: counts } = await req.db.query(
      `SELECT status, COUNT(*), SUM(amount) as total
       FROM withdrawals GROUP BY status`,
    );

    return res.json({ withdrawals: rows, summary: counts });
  } catch (err) {
    console.error("[withdrawals/adminListWithdrawals]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── ADMIN: Process withdrawal ──────────────────────────────────────────
export const adminProcessWithdrawal = async (req, res) => {
  const { id } = req.params;
  const { action, gateway_ref, notes, failure_reason } = req.body;

  if (!["approve", "reject", "mark_paid", "mark_failed"].includes(action)) {
    return res.status(400).json({
      error: "action must be approve, reject, mark_paid, or mark_failed",
    });
  }

  try {
    // ── 1. Fetch withdrawal + maid ────────────────────────────────
    const { rows: wRows } = await req.db.query(
      `SELECT w.*, u.name as maid_name, u.email as maid_email
       FROM withdrawals w
       JOIN users u ON u.id = w.maid_id
       WHERE w.id = $1`,
      [id],
    );
    if (!wRows.length) {
      return res.status(404).json({ error: "withdrawal not found" });
    }

    const w = wRows[0];
    let newStatus;

    // ── 2. Determine new status ───────────────────────────────────
    switch (action) {
      case "approve":
        newStatus = "processing";
        break;
      case "mark_paid":
        newStatus = "paid";
        break;
      case "reject":
        newStatus = "rejected";
        break;
      case "mark_failed":
        newStatus = "failed";
        break;
    }

    // ── 3. Update withdrawal record in DB FIRST ───────────────────
    const { rows } = await req.db.query(
      `UPDATE withdrawals
       SET status         = $1,
           gateway_ref    = $2,
           notes          = $3,
           failure_reason = $4,
           reviewed_by    = $5,
           reviewed_at    = now(),
           updated_at     = now()
       WHERE id = $6
       RETURNING *`,
      [
        newStatus,
        gateway_ref || null,
        notes || null,
        failure_reason || null,
        req.user.id,
        id,
      ],
    );

    if (!rows.length) {
      return res.status(404).json({ error: "withdrawal not found" });
    }

    // ── 4. Wallet updates based on action ─────────────────────────
    if (newStatus === "paid") {
      // Release from pending — maid has been paid
      await req.db.query(
        `UPDATE maid_wallets
         SET pending         = GREATEST(0, pending - $1),
             total_withdrawn = total_withdrawn + $1,
             updated_at      = now()
         WHERE maid_id = $2`,
        [w.amount, w.maid_id],
      );

      // Log the debit
      const wallet = await ensureWallet(req.db, w.maid_id);
      await req.db.query(
        `INSERT INTO wallet_transactions
           (maid_id, type, amount, currency, source, source_id,
            balance_before, balance_after, description)
         VALUES ($1,'debit',$2,$3,'withdrawal',$4,$5,$6,$7)`,
        [
          w.maid_id,
          w.amount,
          w.currency,
          w.id,
          Number(wallet.available) + Number(w.amount),
          wallet.available,
          `Withdrawal paid via ${w.method} — ref: ${gateway_ref || "N/A"}`,
        ],
      );
    }

    if (newStatus === "rejected" || newStatus === "failed") {
      // Return amount to maid's available balance
      const wallet = await ensureWallet(req.db, w.maid_id);

      await req.db.query(
        `UPDATE maid_wallets
         SET available  = available + $1,
             pending    = GREATEST(0, pending - $1),
             updated_at = now()
         WHERE maid_id = $2`,
        [w.amount, w.maid_id],
      );

      // Log the reversal
      await req.db.query(
        `INSERT INTO wallet_transactions
           (maid_id, type, amount, currency, source, source_id,
            balance_before, balance_after, description)
         VALUES ($1,'reversal',$2,$3,'withdrawal',$4,$5,$6,$7)`,
        [
          w.maid_id,
          w.amount,
          w.currency,
          w.id,
          wallet.available,
          Number(wallet.available) + Number(w.amount),
          `Withdrawal ${newStatus} — ${failure_reason || "no reason given"}`,
        ],
      );
    }

    // ── 5. Send in-app notification + email AFTER DB is updated ───
    const statusMessages = {
      processing:
        "Your withdrawal is being processed. You'll receive it within 1–3 business days.",
      paid: `Your withdrawal of ${w.currency} ${Number(w.amount).toLocaleString()} has been paid. Ref: ${gateway_ref || "N/A"}.`,
      rejected: `Your withdrawal was rejected. ${failure_reason || "Contact support."}. Amount returned to your wallet.`,
      failed: `Your withdrawal failed. ${failure_reason || "Contact support."}. Amount returned to your wallet.`,
    };

    await notify(req.db, {
      userId: w.maid_id,
      type: `withdrawal_${newStatus}`,
      title: `Withdrawal ${newStatus}`,
      body:
        statusMessages[newStatus] || `Withdrawal status updated: ${newStatus}`,
      data: { withdrawal_id: w.id, amount: w.amount, currency: w.currency },
      sendMail: () =>
        sendWithdrawalStatusEmail(
          { name: w.maid_name, email: w.maid_email },
          w,
          newStatus,
          gateway_ref,
          failure_reason,
        ),
    });

    return res.json({
      message: `Withdrawal ${newStatus}`,
      withdrawal: rows[0],
    });
  } catch (err) {
    console.error("[withdrawals/adminProcessWithdrawal]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── ADMIN: Auto-process via gateway APIs ───────────────────────────────
export const adminAutoProcess = async (req, res) => {
  const { id } = req.params;

  try {
    const { rows: wRows } = await req.db.query(
      `SELECT w.*, u.email as maid_email, u.name as maid_name
       FROM withdrawals w JOIN users u ON u.id = w.maid_id
       WHERE w.id = $1 AND w.status = 'processing'`,
      [id],
    );
    if (!wRows.length) {
      return res
        .status(404)
        .json({ error: "withdrawal not found or not in processing status" });
    }

    const w = wRows[0];
    let result = {};

    // ── Paystack Transfer (Nigeria) ─────────────────────────────
    if (w.method === "bank_transfer" && w.bank_country === "NG") {
      const transferRes = await fetch("https://api.paystack.co/transfer", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source: "balance",
          amount: Math.round(Number(w.net_amount) * 100),
          recipient: await createPaystackRecipient(w),
          reason: `Deusizi Sparkle withdrawal - ${w.id.slice(0, 8)}`,
        }),
      });
      const data = await transferRes.json();
      if (data.status) {
        result = {
          gateway: "paystack",
          ref: data.data.transfer_code,
          success: true,
        };
      } else {
        result = { gateway: "paystack", success: false, error: data.message };
      }
    }

    // ── Flutterwave Transfer (Africa-wide) ──────────────────────
    if (w.method === "flutterwave") {
      const flwRes = await fetch("https://api.flutterwave.com/v3/transfers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          account_bank: w.bank_code,
          account_number: w.account_number,
          amount: w.net_amount,
          narration: `Deusizi withdrawal ${w.id.slice(0, 8)}`,
          currency: w.currency,
          reference: `DS-${w.id.slice(0, 8)}-${Date.now()}`,
          beneficiary_name: w.account_name,
        }),
      });
      const data = await flwRes.json();
      result = {
        gateway: "flutterwave",
        ref: data.data?.reference,
        success: data.status === "success",
        error: data.message,
      };
    }

    // ── Wise Transfer ───────────────────────────────────────────
    if (w.method === "wise") {
      // Wise requires: create quote → create transfer → fund transfer
      // This is simplified — full Wise flow needs profile + account setup
      result = {
        gateway: "wise",
        success: false,
        note: "Wise requires manual setup — use dashboard",
      };
    }

    // ── PayPal Payout ───────────────────────────────────────────
    if (w.method === "paypal") {
      const accessToken = await getPayPalToken();
      const paypalRes = await fetch(
        `${process.env.PAYPAL_BASE}/v1/payments/payouts`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sender_batch_header: {
              sender_batch_id: `DS-${w.id.slice(0, 8)}-${Date.now()}`,
              email_subject: "You have a payment from Deusizi Sparkle",
            },
            items: [
              {
                recipient_type: "EMAIL",
                amount: { value: String(w.net_amount), currency: w.currency },
                receiver: w.paypal_email,
                note: "Deusizi Sparkle maid payout",
              },
            ],
          }),
        },
      );
      const data = await paypalRes.json();
      result = {
        gateway: "paypal",
        ref: data.batch_header?.payout_batch_id,
        success:
          data.batch_header?.batch_status === "PENDING" ||
          data.batch_header?.batch_status === "SUCCESS",
        error: data.message,
      };
    }

    // Update withdrawal with gateway result
    const finalStatus = result.success ? "paid" : "failed";
    await req.db.query(
      `UPDATE withdrawals
       SET status = $1, gateway_ref = $2, gateway_response = $3,
           failure_reason = $4, updated_at = now()
       WHERE id = $5`,
      [
        finalStatus,
        result.ref || null,
        JSON.stringify(result),
        result.success ? null : result.error || "Gateway error",
        w.id,
      ],
    );

    if (result.success) {
      // Settle wallet
      await req.db.query(
        `UPDATE maid_wallets
         SET pending          = GREATEST(0, pending - $1),
             total_withdrawn = total_withdrawn + $1,
             updated_at      = now()
         WHERE maid_id = $2`,
        [w.amount, w.maid_id],
      );
    } else {
      // Return to available
      await req.db.query(
        `UPDATE maid_wallets
         SET available  = available + $1,
             pending    = GREATEST(0, pending - $1),
             updated_at = now()
         WHERE maid_id = $2`,
        [w.amount, w.maid_id],
      );
    }

    return res.json({ result, status: finalStatus, withdrawal_id: w.id });
  } catch (err) {
    console.error("[withdrawals/adminAutoProcess]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Helper: Create Paystack transfer recipient ─────────────────────────
async function createPaystackRecipient(w) {
  const res = await fetch("https://api.paystack.co/transferrecipient", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "nuban",
      name: w.account_name,
      account_number: w.account_number,
      bank_code: w.bank_code,
      currency: "NGN",
    }),
  });
  const data = await res.json();
  return data.data?.recipient_code;
}

// ── Helper: Get PayPal access token ───────────────────────────────────
async function getPayPalToken() {
  const creds = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
  ).toString("base64");

  const res = await fetch(`${process.env.PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  return data.access_token;
}

// ── Get wallet transaction history ─────────────────────────────────────
export const getWalletHistory = async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  try {
    const { rows } = await req.db.query(
      `SELECT * FROM wallet_transactions
       WHERE maid_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, Number(limit), offset],
    );
    return res.json({ transactions: rows });
  } catch (err) {
    console.error("[withdrawals/getWalletHistory]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Get Nigerian banks list (public) ──────────────────────────────────
export const getNGBanks = async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT name, code, type FROM ng_banks
       WHERE is_active = true
       ORDER BY type ASC, name ASC`,
    );
    return res.json({ banks: rows });
  } catch (err) {
    console.error("[withdrawals/getNGBanks]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Verify Nigerian bank account via Paystack ─────────────────────────
// Lets maid confirm account name before submitting withdrawal
export const verifyNGBankAccount = async (req, res) => {
  const { account_number, bank_code } = req.body;

  if (!account_number || !bank_code) {
    return res
      .status(400)
      .json({ error: "account_number and bank_code are required" });
  }

  try {
    const response = await fetch(
      `https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`,
      {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      },
    );
    const data = await response.json();

    if (!data.status) {
      return res.status(400).json({
        error: "could not verify account",
        details: data.message,
      });
    }

    return res.json({
      account_name: data.data.account_name,
      account_number: data.data.account_number,
      bank_code,
    });
  } catch (err) {
    console.error("[withdrawals/verifyNGBankAccount]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// ── Save maid preferred withdrawal method ─────────────────────────────
// Maids set this once so they don't re-enter every withdrawal
export const saveWithdrawalPreference = async (req, res) => {
  const {
    method,
    // Nigerian bank / fintech
    bank_name,
    bank_code,
    account_number,
    account_name,
    bank_country,
    // Crypto
    crypto_currency,
    crypto_address,
    crypto_network,
    // Mobile money
    mobile_provider,
    mobile_number,
    mobile_country,
    // PayPal
    paypal_email,
    // Wise
    wise_email,
    // Wire
    swift_code,
    iban,
  } = req.body;

  if (!method) return res.status(400).json({ error: "method is required" });

  try {
    // Store in maid_bank_details (reuse existing table, add method column)
    await req.db.query(
      `INSERT INTO maid_bank_details
         (maid_id, bank_name, account_number, account_name, bank_code, country, currency)
       VALUES ($1, $2, $3, $4, $5, $6, 'NGN')
       ON CONFLICT (maid_id) DO UPDATE
       SET bank_name      = EXCLUDED.bank_name,
           account_number = EXCLUDED.account_number,
           account_name   = EXCLUDED.account_name,
           bank_code      = EXCLUDED.bank_code,
           country        = EXCLUDED.country,
           verified       = false,
           updated_at     = now()`,
      [
        req.user.id,
        bank_name || method,
        account_number ||
          crypto_address ||
          mobile_number ||
          paypal_email ||
          wise_email ||
          iban ||
          "",
        account_name || req.user.name || "",
        bank_code || swift_code || mobile_provider || "",
        bank_country || mobile_country || "NG",
      ],
    );

    return res.json({ message: "Withdrawal preference saved" });
  } catch (err) {
    console.error("[withdrawals/saveWithdrawalPreference]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
