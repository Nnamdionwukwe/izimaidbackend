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

    // ─── Enums ───────────────────────────────────────────────
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE cleaning_type AS ENUM ('residential', 'light_commercial');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE cleaning_frequency AS ENUM ('recurring', 'one_time', 'move_in_out');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE lead_status AS ENUM ('new', 'contacted', 'converted', 'lost');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    console.log("[migrate] ✓ enums created");

    // ─── Leads table ─────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Contact info
        first_name                   TEXT NOT NULL,
        last_name                    TEXT NOT NULL,
        email                        TEXT NOT NULL,
        phone_number                 TEXT NOT NULL,
        text_me_messages             BOOLEAN NOT NULL DEFAULT false,

        -- Location
        zip_code                     TEXT NOT NULL,
        service_address              TEXT NOT NULL,
        apartment_suite              TEXT,

        -- Cleaning type
        cleaning_type                cleaning_type NOT NULL DEFAULT 'residential',
        frequency                    cleaning_frequency NOT NULL DEFAULT 'recurring',

        -- Residential fields
        residential_sqft             TEXT,
        bedrooms                     INT,
        bathrooms                    INT,
        recurring_plan               TEXT,

        -- Light commercial fields
        commercial_sqft              TEXT,
        offices                      INT,
        commercial_bathrooms         INT,
        commercial_frequency         TEXT,
        is_move_in_out               BOOLEAN DEFAULT false,

        -- Meta
        status                       lead_status NOT NULL DEFAULT 'new',
        notes                        TEXT,
        created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    console.log("[migrate] ✓ leads table created");

    // ─── Indexes ─────────────────────────────────────────────
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_leads_email   ON leads(email)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_leads_status  ON leads(status)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC)`,
    );

    console.log("[migrate] ✓ indexes created");

    // ─── updated_at trigger ──────────────────────────────────
    await client.query(`
      CREATE OR REPLACE FUNCTION update_leads_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
      $$ LANGUAGE plpgsql
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
      CREATE TRIGGER trg_leads_updated_at
        BEFORE UPDATE ON leads
        FOR EACH ROW EXECUTE FUNCTION update_leads_updated_at()
    `);

    console.log("[migrate] ✓ trigger created");

    await client.query("COMMIT");
    console.log("[migrate] ✓ leads migration completed successfully");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[migrate] ✗ failed, rolled back:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
