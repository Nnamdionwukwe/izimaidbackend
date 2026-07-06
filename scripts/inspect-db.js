// scripts/inspect-db.js
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function inspect() {
  const client = await db.connect();
  try {
    console.log("🔍 Inspecting database tables...\n");

    // ── 1. Payments table schema ──
    console.log("📦 Payments table columns:");
    const { rows: columns } = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'payments'
      ORDER BY ordinal_position;
    `);
    console.table(columns);

    // ── 2. Latest payments (last 5) ──
    console.log("\n📋 Latest 5 payments:");
    const { rows: payments } = await client.query(`
      SELECT id, customer_id, amount, currency, gateway,
             flutterwave_tx_ref, flutterwave_payment_id,
             status, paid_at, created_at, notes
      FROM payments
      ORDER BY created_at DESC
      LIMIT 5;
    `);
    console.table(payments);

    // ── 3. Check for pending Flutterwave payments ──
    console.log("\n⏳ Pending Flutterwave payments:");
    const { rows: pending } = await client.query(`
      SELECT id, customer_id, amount, currency,
             flutterwave_tx_ref, flutterwave_payment_id,
             status, created_at, notes
      FROM payments
      WHERE gateway = 'flutterwave' AND status = 'pending'
      ORDER BY created_at DESC;
    `);
    if (pending.length === 0) {
      console.log("  No pending Flutterwave payments found.");
    } else {
      console.table(pending);
    }

    // ── 4. Check if notes column has valid JSON ──
    console.log("\n📝 Notes content (first 3 payments with notes):");
    const { rows: withNotes } = await client.query(`
      SELECT id, notes, flutterwave_tx_ref
      FROM payments
      WHERE notes IS NOT NULL AND notes != ''
      ORDER BY created_at DESC
      LIMIT 3;
    `);
    if (withNotes.length === 0) {
      console.log("  No notes found.");
    } else {
      withNotes.forEach((row, i) => {
        console.log(`\n  Payment ${i + 1} (id: ${row.id}):`);
        try {
          const parsed = JSON.parse(row.notes);
          console.log("    Parsed JSON:", parsed);
        } catch {
          console.log("    Raw notes:", row.notes);
        }
      });
    }

    // ── 5. Check subscriptions table ──
    console.log("\n📋 Active subscriptions (last 5):");
    const { rows: subscriptions } = await client.query(`
      SELECT s.id, s.user_id, sp.display_name, s.status, s.amount,
             s.currency, s.created_at
      FROM subscriptions s
      JOIN subscription_plans sp ON sp.id = s.plan_id
      WHERE s.status IN ('active','trialing','pending')
      ORDER BY s.created_at DESC
      LIMIT 5;
    `);
    if (subscriptions.length === 0) {
      console.log("  No active/trialing/pending subscriptions found.");
    } else {
      console.table(subscriptions);
    }

    console.log("\n✅ Inspection complete.");
  } catch (error) {
    console.error("❌ Inspection failed:", error);
  } finally {
    client.release();
    await db.end();
  }
}

inspect();
