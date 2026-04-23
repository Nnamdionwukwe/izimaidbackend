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
    let { rows: wallets } = await req.db.query(
      `SELECT currency, available_balance, pending_balance,
              total_earned, total_withdrawn, updated_at
       FROM maid_wallets
       WHERE maid_id = $1
       ORDER BY total_earned DESC`,
      [req.user.id],
    );

    // ── If wallet rows exist but all show 0, check if bookings disagree ──
    // This catches the case where the table exists but was never credited
    if (!wallets.length || wallets.every((w) => Number(w.total_earned) === 0)) {
      const { rows: earnRows } = await req.db.query(
        `
        SELECT
          COALESCE(p.currency, mp.currency, 'NGN') AS currency,
          COALESCE(SUM(b.total_amount * 0.9), 0)   AS total_earned
        FROM bookings b
        LEFT JOIN payments p
          ON p.booking_id = b.id AND p.status = 'success'
        LEFT JOIN maid_profiles mp
          ON mp.user_id = b.maid_id
        WHERE b.maid_id = $1
          AND b.status  = 'completed'
          AND b.total_amount > 0
        GROUP BY COALESCE(p.currency, mp.currency, 'NGN')
      `,
        [req.user.id],
      );

      if (earnRows.length > 0) {
        // Wallets exist but are empty — update them from actual earnings
        for (const row of earnRows) {
          await req.db.query(
            `
            INSERT INTO maid_wallets
              (maid_id, currency, available_balance, pending_balance, total_earned, total_withdrawn)
            VALUES ($1, $2, $3, 0, $3, 0)
            ON CONFLICT (maid_id, currency)
            DO UPDATE SET
              available_balance = GREATEST(maid_wallets.available_balance, $3),
              total_earned      = GREATEST(maid_wallets.total_earned,      $3),
              updated_at        = now()
          `,
            [req.user.id, row.currency, row.total_earned],
          );
        }

        // Re-fetch after update
        const { rows: refreshed } = await req.db.query(
          `SELECT currency, available_balance, pending_balance,
                  total_earned, total_withdrawn, updated_at
           FROM maid_wallets WHERE maid_id = $1
           ORDER BY total_earned DESC`,
          [req.user.id],
        );
        wallets = refreshed;
      }
    }

    // If still nothing, create empty NGN wallet
    if (!wallets.length) {
      await req.db.query(
        `
        INSERT INTO maid_wallets (maid_id, currency)
        VALUES ($1, 'NGN')
        ON CONFLICT (maid_id, currency) DO NOTHING
      `,
        [req.user.id],
      );

      wallets = [
        {
          currency: "NGN",
          available_balance: 0,
          pending_balance: 0,
          total_earned: 0,
          total_withdrawn: 0,
        },
      ];
    }

    const primary = wallets[0];

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
