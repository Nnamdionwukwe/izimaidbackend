import "dotenv/config";
import express from "express";
import cors from "cors";

import pool from "./src/config/database.js";
import redis from "./src/config/redis.js";

import authRoutes from "./src/routes/auth.js";
import maidsRoutes from "./src/routes/maids.js";
import bookingsRoutes from "./src/routes/bookings.js";
import paymentsRoutes from "./src/routes/payments.js";
import adminRoutes from "./src/routes/admin.js";

const app = express();
const PORT = process.env.PORT || 8080;

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use("/api/payments/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

app.use((req, _res, next) => {
  req.db = pool;
  req.redis = redis;
  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/maids", maidsRoutes);
app.use("/api/bookings", bookingsRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/admin", adminRoutes);

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

app.use((_req, res) => res.status(404).json({ error: "not found" }));

app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  res.status(err.status || 500).json({
    error:
      process.env.NODE_ENV === "production"
        ? "internal server error"
        : err.message,
  });
});

app.listen(PORT, () => {
  console.log(`✓ izimaidbackend running on port ${PORT}`);
});

export { pool, redis };
