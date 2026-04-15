import pg from "pg";

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
  max: 10, // ← max 10 connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("connect", () => {
  console.log("✓ Postgres connected");
});

pool.on("error", (err) => {
  console.error("✗ Postgres client error:", err);
});

export const query = (text, params) => pool.query(text, params);
export default pool;
