import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on("connect", () => {
  console.log("✓ Postgres connected");
});

pool.on("error", (err) => {
  console.error("✗ Postgres client error:", err);
});

export const query = (text, params) => pool.query(text, params);
export default pool;
