// db/fix-subscriptions-constraint.js
import { config } from "dotenv";
config(); // <-- loads .env variables including DATABASE_URL

import pool from "../src/config/database.js";

const masked = process.env.DATABASE_URL?.replace(/:([^:@]{4,})@/, ":****@");
console.log("→ Connecting to:", masked);

async function dropConstraintAndAddIndex() {
  try {
    console.log("Dropping constraint if it exists...");
    await pool.query(`
      ALTER TABLE subscriptions
      DROP CONSTRAINT IF EXISTS subscriptions_user_id_status_key;
    `);

    console.log(
      "Creating partial index to allow only one active subscription...",
    );
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_sub_per_user
      ON subscriptions (user_id)
      WHERE status = 'active';
    `);

    console.log(
      "✅ Done: users can now have multiple cancelled subscriptions.",
    );
  } catch (err) {
    console.error("❌ Error updating schema:", err);
  } finally {
    await pool.end();
  }
}

dropConstraintAndAddIndex();
