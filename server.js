import express from "express";
import cors from "cors";
import pg from "pg";
import { createClient } from "redis";

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
app.use(express.json());

// ─── Postgres ─────────────────────────────────────────────────
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

pool.on("error", (err) => {
  console.error("[postgres] unexpected error on idle client", err);
});

// ─── Redis ────────────────────────────────────────────────────
const redis = createClient({
  url: process.env.REDIS_URL,
});

redis.on("error", (err) => console.error("[redis] error", err));
redis.on("connect", () => console.log("[redis] connected"));

await redis.connect();

// ─── Make db & redis available on req ─────────────────────────
app.use((req, _res, next) => {
  req.db = pool;
  req.redis = redis;
  next();
});

// ─── Health check ─────────────────────────────────────────────
app.get("/health", async (_req, res) => {
  const status = { postgres: "ok", redis: "ok" };

  try {
    await pool.query("SELECT 1");
  } catch (err) {
    status.postgres = err.message;
  }

  try {
    await redis.ping();
  } catch (err) {
    status.redis = err.message;
  }

  const healthy = status.postgres === "ok" && status.redis === "ok";
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "degraded",
    ...status,
  });
});

// ─── Routes ───────────────────────────────────────────────────
// TODO: import and mount your route files here
// e.g. import authRoutes from './routes/auth.js'
//      app.use('/api/auth', authRoutes)

// ─── 404 handler ──────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "not found" });
});

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
app.listen(PORT, () => {
  console.log(`[server] izimaidbackend running on port ${PORT}`);
});

export { pool, redis };
