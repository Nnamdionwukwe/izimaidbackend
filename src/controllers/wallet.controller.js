// src/controllers/wallet.controller.js

// ── Ensure wallet row exists for maid+currency ─────────────────
async function ensureWallet(db, maidId, currency = "NGN") {
  currency = (currency || "NGN").toUpperCase();
  const existing = await db.query(
    "SELECT id FROM maid_wallets WHERE maid_id = $1 AND currency = $2",
    [maidId, currency],
  );
  if (existing.rows.length > 0) return;
  try {
    await db.query(
      "INSERT INTO maid_wallets (maid_id, currency, available_balance, pending_balance, total_earned, total_withdrawn) VALUES ($1, $2, 0, 0, 0, 0)",
      [maidId, currency],
    );
  } catch (e) {
    if (e.code !== "23505") throw e;
  }
}

// GET /api/wallet  — returns ALL currency balances for the maid
export const getWallet = async (req, res) => {
  try {
    // ── Always sync ALL currencies from actual completed bookings ──
    const { rows: earnRows } = await req.db.query(
      `SELECT
         COALESCE(p.currency, mp.currency, 'NGN') AS currency,
         COALESCE(SUM(b.total_amount * 0.9), 0)   AS total_earned
       FROM bookings b
       LEFT JOIN payments p ON p.booking_id = b.id AND p.status = 'success'
       LEFT JOIN maid_profiles mp ON mp.user_id = b.maid_id
       WHERE b.maid_id = $1
         AND b.status = 'completed'
         AND b.total_amount > 0
       GROUP BY COALESCE(p.currency, mp.currency, 'NGN')`,
      [req.user.id],
    );

    for (const row of earnRows) {
      const currency = (row.currency || "NGN").toUpperCase();
      const earned = Number(row.total_earned);

      await req.db.query(
        `INSERT INTO maid_wallets
           (maid_id, currency, available_balance, pending_balance, total_earned, total_withdrawn)
         VALUES ($1, $2, $3, 0, $3, 0)
         ON CONFLICT (maid_id, currency) DO UPDATE SET
           total_earned = GREATEST(maid_wallets.total_earned, $3),
           available_balance = GREATEST(
             maid_wallets.available_balance,
             GREATEST(0, $3 - maid_wallets.total_withdrawn - maid_wallets.pending_balance)
           ),
           updated_at = now()`,
        [req.user.id, currency, earned],
      );
    }

    // Ensure at least one NGN wallet exists
    await req.db.query(
      `INSERT INTO maid_wallets
         (maid_id, currency, available_balance, pending_balance, total_earned, total_withdrawn)
       VALUES ($1, 'NGN', 0, 0, 0, 0)
       ON CONFLICT (maid_id, currency) DO NOTHING`,
      [req.user.id],
    );

    // Fetch all wallet rows after sync
    const { rows: wallets } = await req.db.query(
      `SELECT currency, available_balance, pending_balance,
              total_earned, total_withdrawn, updated_at
       FROM maid_wallets
       WHERE maid_id = $1
       ORDER BY total_earned DESC`,
      [req.user.id],
    );

    const primary = wallets[0] || {
      currency: "NGN",
      available_balance: 0,
      pending_balance: 0,
      total_earned: 0,
      total_withdrawn: 0,
    };

    return res.json({
      wallets,
      wallet: {
        ...primary,
        available: Number(primary.available_balance),
        pending: Number(primary.pending_balance),
      },
    });
  } catch (err) {
    console.error("[wallet/getWallet]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// GET /api/wallet/history  — paginated ledger, optionally filtered by currency
export const getWalletHistory = async (req, res) => {
  const { currency, limit = 30, page = 1 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const params = [req.user.id];
  const conditions = ["maid_id = $1"];

  if (currency) {
    params.push(currency.toUpperCase());
    conditions.push(`currency = $${params.length}`);
  }

  try {
    const { rows } = await req.db.query(
      `SELECT id, currency, type, amount, balance_after,
              description, reference, booking_id, created_at
       FROM wallet_transactions
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, Number(limit), offset],
    );

    return res.json({ transactions: rows, history: rows });
  } catch (err) {
    console.error("[wallet/getWalletHistory]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// POST /api/wallet/credit  — internal use by payment controller after booking paid
export async function creditMaidWallet(
  db,
  { maidId, currency, amount, description, bookingId, reference },
) {
  currency = (currency || "NGN").toUpperCase();
  await ensureWallet(db, maidId, currency);

  const { rows } = await db.query(
    `
    UPDATE maid_wallets
    SET pending_balance = pending_balance + $1,
        total_earned    = total_earned    + $1,
        updated_at      = now()
    WHERE maid_id = $2 AND currency = $3
    RETURNING pending_balance`,
    [amount, maidId, currency],
  );

  await db.query(
    `
    INSERT INTO wallet_transactions
      (maid_id, currency, type, amount, balance_after, description, reference, booking_id)
    VALUES ($1,$2,'credit',$3,$4,$5,$6,$7)`,
    [
      maidId,
      currency,
      amount,
      Number(rows[0]?.pending_balance || 0),
      description || "Booking payment",
      reference || null,
      bookingId || null,
    ],
  );
}

// POST /api/wallet/release  — move pending → available (admin or auto after 24h)
export async function releasePendingToAvailable(db, maidId, currency, amount) {
  currency = (currency || "NGN").toUpperCase();
  const { rows } = await db.query(
    `
    UPDATE maid_wallets
    SET pending_balance   = GREATEST(0, pending_balance   - $1),
        available_balance = available_balance + $1,
        updated_at        = now()
    WHERE maid_id = $2 AND currency = $3
    RETURNING available_balance`,
    [amount, maidId, currency],
  );

  await db.query(
    `
    INSERT INTO wallet_transactions
      (maid_id, currency, type, amount, balance_after, description)
    VALUES ($1,$2,'release',$3,$4,'Funds released to available balance')`,
    [maidId, currency, amount, Number(rows[0]?.available_balance || 0)],
  );
}

// Internal: deduct on withdrawal
export async function deductWalletBalance(
  db,
  maidId,
  currency,
  amount,
  withdrawalId,
) {
  currency = (currency || "NGN").toUpperCase();
  const { rows } = await db.query(
    `
    UPDATE maid_wallets
    SET available_balance = GREATEST(0, available_balance - $1),
        total_withdrawn   = total_withdrawn + $1,
        updated_at        = now()
    WHERE maid_id = $2 AND currency = $3
    RETURNING available_balance`,
    [amount, maidId, currency],
  );

  await db.query(
    `
    INSERT INTO wallet_transactions
      (maid_id, currency, type, amount, balance_after, description, withdrawal_id)
    VALUES ($1,$2,'debit',$3,$4,'Withdrawal',$5)`,
    [
      maidId,
      currency,
      amount,
      Number(rows[0]?.available_balance || 0),
      withdrawalId || null,
    ],
  );
}

// ══════════════════════════════════════════════════════════════════════
//  ADMIN WALLET FUNCTIONS — add these to wallet.controller.js
// ══════════════════════════════════════════════════════════════════════

// GET /api/wallet/admin  — list all maids' wallets with totals
export const adminListWallets = async (req, res) => {
  const { currency, search, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const conditions = [];
  const params = [];

  if (currency) {
    params.push(currency.toUpperCase());
    conditions.push(`mw.currency = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`,
    );
  }

  const where = conditions.length ? `AND ${conditions.join(" AND ")}` : "";
  params.push(Number(limit), offset);

  try {
    const { rows } = await req.db.query(
      `SELECT
         mw.id, mw.maid_id, mw.currency,
         mw.available_balance, mw.pending_balance,
         mw.total_earned, mw.total_withdrawn,
         mw.updated_at,
         u.name AS maid_name, u.email AS maid_email, u.avatar AS maid_avatar,
         u.is_active
       FROM maid_wallets mw
       JOIN users u ON u.id = mw.maid_id
       WHERE u.role = 'maid' ${where}
       ORDER BY mw.total_earned DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const { rows: countRows } = await req.db.query(
      `SELECT COUNT(*) FROM maid_wallets mw
       JOIN users u ON u.id = mw.maid_id
       WHERE u.role = 'maid' ${where}`,
      params.slice(0, -2),
    );

    // Platform totals per currency
    const { rows: totals } = await req.db.query(
      `SELECT
         currency,
         COALESCE(SUM(available_balance), 0) AS total_available,
         COALESCE(SUM(pending_balance),   0) AS total_pending,
         COALESCE(SUM(total_earned),      0) AS total_earned,
         COALESCE(SUM(total_withdrawn),   0) AS total_withdrawn,
         COUNT(DISTINCT maid_id) AS maid_count
       FROM maid_wallets
       GROUP BY currency
       ORDER BY total_earned DESC`,
    );

    return res.json({
      wallets: rows,
      total: Number(countRows[0].count),
      page: Number(page),
      limit: Number(limit),
      platform_totals: totals,
    });
  } catch (err) {
    console.error("[wallet/adminListWallets]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// GET /api/wallet/admin/:maidId  — get all wallets + history for one maid
export const adminGetMaidWallet = async (req, res) => {
  const { maidId } = req.params;
  const { page = 1, limit = 30 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  try {
    const { rows: wallets } = await req.db.query(
      `SELECT currency, available_balance, pending_balance,
              total_earned, total_withdrawn, updated_at
       FROM maid_wallets
       WHERE maid_id = $1
       ORDER BY total_earned DESC`,
      [maidId],
    );

    const { rows: transactions } = await req.db.query(
      `SELECT id, currency, type, amount, balance_after,
              description, reference, booking_id, created_at
       FROM wallet_transactions
       WHERE maid_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [maidId, Number(limit), offset],
    );

    const { rows: maidRows } = await req.db.query(
      `SELECT u.id, u.name, u.email, u.avatar
       FROM users u WHERE u.id = $1`,
      [maidId],
    );

    return res.json({
      maid: maidRows[0] || null,
      wallets,
      transactions,
    });
  } catch (err) {
    console.error("[wallet/adminGetMaidWallet]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// POST /api/wallet/admin/:maidId/credit  — manually credit a maid's wallet
export const adminCreditWallet = async (req, res) => {
  const { maidId } = req.params;
  const { currency = "NGN", amount, description, reference } = req.body;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: "amount must be greater than 0" });
  }

  try {
    // Verify maid exists
    const { rows: maidRows } = await req.db.query(
      `SELECT id, name FROM users WHERE id = $1 AND role = 'maid'`,
      [maidId],
    );
    if (!maidRows.length) {
      return res.status(404).json({ error: "maid not found" });
    }

    const cur = currency.toUpperCase();
    const amt = Number(amount);

    // Upsert wallet then credit available_balance directly
    await req.db.query(
      `INSERT INTO maid_wallets
         (maid_id, currency, available_balance, pending_balance, total_earned, total_withdrawn)
       VALUES ($1, $2, $3, 0, $3, 0)
       ON CONFLICT (maid_id, currency) DO UPDATE SET
         available_balance = maid_wallets.available_balance + $3,
         total_earned      = maid_wallets.total_earned      + $3,
         updated_at        = now()`,
      [maidId, cur, amt],
    );

    // Log transaction
    const { rows: walletRows } = await req.db.query(
      `SELECT available_balance FROM maid_wallets WHERE maid_id = $1 AND currency = $2`,
      [maidId, cur],
    );

    await req.db.query(
      `INSERT INTO wallet_transactions
         (maid_id, currency, type, amount, balance_after, description, reference)
       VALUES ($1, $2, 'credit', $3, $4, $5, $6)`,
      [
        maidId,
        cur,
        amt,
        Number(walletRows[0]?.available_balance || 0),
        description || `Admin credit by ${req.user.id}`,
        reference || null,
      ],
    );

    return res.json({
      message: `${cur} ${amt.toLocaleString()} credited to ${maidRows[0].name}'s wallet`,
      wallet: walletRows[0],
    });
  } catch (err) {
    console.error("[wallet/adminCreditWallet]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// POST /api/wallet/admin/:maidId/release  — release pending → available
export const adminReleaseWallet = async (req, res) => {
  const { maidId } = req.params;
  const { currency = "NGN", amount } = req.body;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: "amount must be greater than 0" });
  }

  try {
    const cur = currency.toUpperCase();
    const amt = Number(amount);

    const { rows } = await req.db.query(
      `UPDATE maid_wallets
       SET pending_balance   = GREATEST(0, pending_balance   - $1),
           available_balance = available_balance + $1,
           updated_at        = now()
       WHERE maid_id = $2 AND currency = $3
       RETURNING available_balance, pending_balance`,
      [amt, maidId, cur],
    );

    if (!rows.length) {
      return res.status(404).json({ error: "wallet not found" });
    }

    await req.db.query(
      `INSERT INTO wallet_transactions
         (maid_id, currency, type, amount, balance_after, description)
       VALUES ($1, $2, 'release', $3, $4, $5)`,
      [
        maidId,
        cur,
        amt,
        Number(rows[0].available_balance),
        `Admin released pending funds`,
      ],
    );

    return res.json({
      message: `${cur} ${amt.toLocaleString()} released to available`,
      wallet: rows[0],
    });
  } catch (err) {
    console.error("[wallet/adminReleaseWallet]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};

// POST /api/wallet/admin/:maidId/adjust  — manual debit / correction
export const adminAdjustWallet = async (req, res) => {
  const { maidId } = req.params;
  const { currency = "NGN", amount, type = "debit", description } = req.body;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: "amount must be greater than 0" });
  }
  if (!["credit", "debit"].includes(type)) {
    return res.status(400).json({ error: "type must be credit or debit" });
  }

  try {
    const cur = currency.toUpperCase();
    const amt = Number(amount);

    const field =
      type === "credit"
        ? `available_balance = available_balance + $1, total_earned = total_earned + $1`
        : `available_balance = GREATEST(0, available_balance - $1)`;

    const { rows } = await req.db.query(
      `UPDATE maid_wallets
       SET ${field}, updated_at = now()
       WHERE maid_id = $2 AND currency = $3
       RETURNING available_balance, pending_balance`,
      [amt, maidId, cur],
    );

    if (!rows.length) {
      return res
        .status(404)
        .json({ error: "wallet not found for this currency" });
    }

    await req.db.query(
      `INSERT INTO wallet_transactions
         (maid_id, currency, type, amount, balance_after, description)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        maidId,
        cur,
        type,
        amt,
        Number(rows[0].available_balance),
        description || `Admin ${type} adjustment`,
      ],
    );

    return res.json({
      message: `Wallet adjusted`,
      wallet: rows[0],
    });
  } catch (err) {
    console.error("[wallet/adminAdjustWallet]", err);
    return res.status(500).json({ error: "internal server error" });
  }
};
