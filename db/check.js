import pg from "pg";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("connect", () => {
  console.log("✓ Postgres connected to Railway database\n");
});

pool.on("error", (err) => {
  console.error("✗ Postgres client error:", err);
});

const client = await pool.connect();

try {
  console.log("🔍 Checking bookings table structure...\n");

  // 1. Check if bookings table exists
  const tableCheck = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'bookings'
    ) AS exists
  `);

  if (!tableCheck.rows[0].exists) {
    console.log("❌ bookings table does not exist!");
    console.log("   Please create the bookings table first.\n");
    process.exit(1);
  }

  console.log("✅ bookings table exists\n");

  // 2. Get the current schema of the bookings table
  const schemaCheck = await client.query(`
    SELECT 
      column_name, 
      data_type, 
      is_nullable
    FROM information_schema.columns
    WHERE table_name = 'bookings'
    ORDER BY ordinal_position
  `);

  console.log("📋 Current bookings table columns:\n");
  schemaCheck.rows.forEach((col) => {
    const nullable = col.is_nullable === "YES" ? "nullable" : "NOT NULL";
    console.log(`   • ${col.column_name} (${col.data_type}) — ${nullable}`);
  });
  console.log();

  // 3. Check if checkout_lat and checkout_lng columns already exist
  const checkoutLatExists = schemaCheck.rows.some(
    (col) => col.column_name === "checkout_lat",
  );
  const checkoutLngExists = schemaCheck.rows.some(
    (col) => col.column_name === "checkout_lng",
  );

  console.log("🔎 Checking for checkout location columns...\n");

  if (checkoutLatExists && checkoutLngExists) {
    console.log("✅ checkout_lat column exists");
    console.log("✅ checkout_lng column exists");
    console.log("\n✓ Migration already applied. No changes needed.\n");
    process.exit(0);
  }

  if (!checkoutLatExists) {
    console.log("❌ checkout_lat column is MISSING");
  } else {
    console.log("✅ checkout_lat column exists");
  }

  if (!checkoutLngExists) {
    console.log("❌ checkout_lng column is MISSING");
  } else {
    console.log("✅ checkout_lng column exists");
  }

  console.log();

  // 4. Apply migration
  if (!checkoutLatExists || !checkoutLngExists) {
    console.log("⏳ Applying migration...\n");

    await client.query(`
      ALTER TABLE bookings 
      ADD COLUMN IF NOT EXISTS checkout_lat NUMERIC,
      ADD COLUMN IF NOT EXISTS checkout_lng NUMERIC;
    `);

    console.log("✅ Migration applied successfully!\n");

    // 5. Verify columns were added
    const verifySchema = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'bookings' 
      AND (column_name = 'checkout_lat' OR column_name = 'checkout_lng')
      ORDER BY column_name
    `);

    console.log("✅ Verification — New columns added:\n");
    verifySchema.rows.forEach((col) => {
      const nullable = col.is_nullable === "YES" ? "nullable" : "NOT NULL";
      console.log(`   • ${col.column_name} (${col.data_type}) — ${nullable}`);
    });
    console.log();
  }

  // 6. Final summary
  const finalSchema = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'bookings'
    AND column_name IN (
      'id', 'checkin_at', 'checkin_lat', 'checkin_lng', 
      'checkout_at', 'checkout_lat', 'checkout_lng', 'customer_name', 'address'
    )
    ORDER BY column_name
  `);

  console.log("📋 Current booking location tracking columns:");
  console.log("─".repeat(50));
  finalSchema.rows.forEach((col) => {
    console.log(`   ✓ ${col.column_name.padEnd(20)} (${col.data_type})`);
  });
  console.log("─".repeat(50));
  console.log();

  console.log("💡 Next step:");
  console.log(
    "   Update React component to use booking.checkout_lat/checkout_lng",
  );
  console.log("   instead of latestLocation for cleaner data ownership.\n");
} catch (err) {
  console.error("❌ Error:", err.message);
  console.error(err.stack);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
  console.log("Done.\n");
}
