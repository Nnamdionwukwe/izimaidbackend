import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

async function migrate() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ─── Extensions ─────────────────────────────────────────
    await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // ─── Enums ──────────────────────────────────────────────
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE user_role AS ENUM ('customer', 'maid', 'admin');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE booking_status AS ENUM (
          'pending', 'confirmed', 'in_progress', 'completed', 'cancelled'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE payment_status AS ENUM ('pending', 'success', 'failed', 'refunded');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    // ─── Users ──────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email       TEXT UNIQUE NOT NULL,
        name        TEXT NOT NULL,
        avatar      TEXT,
        role        user_role NOT NULL DEFAULT 'customer',
        google_id   TEXT UNIQUE,
        is_active   BOOLEAN NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ─── Maid profiles ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS maid_profiles (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        bio            TEXT,
        hourly_rate    NUMERIC(10,2) NOT NULL DEFAULT 0,
        years_exp      INT NOT NULL DEFAULT 0,
        services       TEXT[] NOT NULL DEFAULT '{}',
        location       TEXT,
        is_available   BOOLEAN NOT NULL DEFAULT true,
        rating         NUMERIC(3,2) NOT NULL DEFAULT 0.00,
        total_reviews  INT NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ─── Bookings ───────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        maid_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status          booking_status NOT NULL DEFAULT 'pending',
        service_date    TIMESTAMPTZ NOT NULL,
        duration_hours  NUMERIC(4,1) NOT NULL,
        address         TEXT NOT NULL,
        notes           TEXT,
        total_amount    NUMERIC(10,2) NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ─── Payments ───────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id           UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        customer_id          UUID NOT NULL REFERENCES users(id),
        amount               NUMERIC(10,2) NOT NULL,
        currency             TEXT NOT NULL DEFAULT 'NGN',
        status               payment_status NOT NULL DEFAULT 'pending',
        paystack_reference   TEXT UNIQUE,
        paystack_access_code TEXT,
        paid_at              TIMESTAMPTZ,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ─── Reviews ────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id  UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
        customer_id UUID NOT NULL REFERENCES users(id),
        maid_id     UUID NOT NULL REFERENCES users(id),
        rating      INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment     TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ─── Indexes ────────────────────────────────────────────
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_maid_profiles_user_id  ON maid_profiles(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_maid_profiles_available ON maid_profiles(is_available)`,
      `CREATE INDEX IF NOT EXISTS idx_bookings_customer       ON bookings(customer_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bookings_maid           ON bookings(maid_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bookings_status         ON bookings(status)`,
      `CREATE INDEX IF NOT EXISTS idx_payments_booking        ON payments(booking_id)`,
      `CREATE INDEX IF NOT EXISTS idx_payments_reference      ON payments(paystack_reference)`,
    ];

    for (const idx of indexes) {
      await client.query(idx);
    }

    // ─── updated_at trigger function ────────────────────────
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
      $$ LANGUAGE plpgsql
    `);

    const triggerTables = ["users", "maid_profiles", "bookings"];
    for (const table of triggerTables) {
      await client.query(`
        DROP TRIGGER IF EXISTS trg_${table}_updated_at ON ${table};
        CREATE TRIGGER trg_${table}_updated_at
          BEFORE UPDATE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION update_updated_at()
      `);
    }

    await client.query("COMMIT");
    console.log("[migrate] all tables created successfully");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[migrate] failed, rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
