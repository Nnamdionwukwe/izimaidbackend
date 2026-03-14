// health.js (or add directly to your main file)
import { Pool } from "pg";
import { createClient } from "redis";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

app.get("/health", async (req, res) => {
  const status = { postgres: "ok", redis: "ok" };

  try {
    await pool.query("SELECT 1");
  } catch (e) {
    status.postgres = e.message;
  }

  try {
    await redis.ping();
  } catch (e) {
    status.redis = e.message;
  }

  const ok = status.postgres === "ok" && status.redis === "ok";
  res
    .status(ok ? 200 : 503)
    .json({ status: ok ? "healthy" : "degraded", ...status });
});
