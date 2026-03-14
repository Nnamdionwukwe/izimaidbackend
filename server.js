import express from "express";
import cors from "cors";
import pg from "pg";
import { createClient } from "redis";

import authRoutes from "./routes/auth.js";
import maidsRoutes from "./routes/maids.js";
import bookingsRoutes from "./routes/bookings.js";
import paymentsRoutes from "./routes/payments.js";
import adminRoutes from "./routes/admin.js";

const app = express();
const PORT = process.env.PORT || 8080;

// ─── Middleware ───────────────────────────────────────────────
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use("/api/payments/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// ─── Postgres ─────────────────────────────────────────────────
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});
pool.on("error", (err) => console.error("[postgres] idle client error", err));

// ─── Redis ────────────────────────────────────────────────────
const redis = createClient({ url: process.env.REDIS_URL });
redis.on("error", (err) => console.error("[redis] error", err));

// ─── Attach db + redis to every request ───────────────────────
app.use((req, _res, next) => {
  req.db = pool;
  req.redis = redis;
  next();
});

// ─── Routes ───────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/maids", maidsRoutes);
app.use("/api/bookings", bookingsRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/admin", adminRoutes);

// ─── Health check ─────────────────────────────────────────────
app.get("/health", async (_req, res) => {
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
  const healthy = status.postgres === "ok" && status.redis === "ok";
  res
    .status(healthy ? 200 : 503)
    .json({ status: healthy ? "healthy" : "degraded", ...status });
});

// ─── 404 ──────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: "not found" }));

// ─── Global error handler ─────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  res.status(err.status || 500).json({
    error:
      process.env.NODE_ENV === "production"
        ? "internal server error"
        : err.message,
  });
});

// ─── Start ────────────────────────────────────────────────────
async function start() {
  try {
    await redis.connect();
    console.log("[redis] connected");

    await pool.query("SELECT 1");
    console.log("[postgres] connected");

    app.listen(PORT, () => {
      console.log(`[server] izimaidbackend running on port ${PORT}`);
    });
  } catch (err) {
    console.error("[startup] failed:", err);
    process.exit(1);
  }
}

start();

export { pool, redis };
