import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import pool from "./src/config/database.js";
import redis from "./src/config/redis.js";

// ── Webhook controllers imported before express.json() ────────────────
// These MUST be imported here because they need express.raw() middleware
// which must be registered before express.json()
import { stripeWebhook } from "./src/controllers/payments.js";
import { stripeSubscriptionWebhook } from "./src/controllers/subscriptions.controller.js";

// ── Route imports ─────────────────────────────────────────────────────
import authRoutes from "./src/routes/auth.js";
import maidsRoutes from "./src/routes/maids.js";
import bookingsRoutes from "./src/routes/bookings.js";
import paymentsRoutes from "./src/routes/payments.js";
import adminRoutes from "./src/routes/admin.js";
import leadsRoutes from "./src/routes/leads.js";
import customerSupportRoutes from "./src/routes/customer-support.js";
import maidSupportRoutes from "./src/routes/maid-support.js";
import chatRoutes from "./src/routes/chat.routes.js";
import supportChatRouter from "./src/routes/support-chat.routes.js";
import maidSupportChatRouter from "./src/routes/maid-support-chat.routes.js";
import settingsRoutes from "./src/routes/settings.routes.js";
import notificationsRoutes from "./src/routes/notifications.routes.js";
import withdrawalsRoutes from "./src/routes/withdrawals.routes.js";
import subscriptionsRoutes from "./src/routes/subscriptions.routes.js";
import earningsRouter from "./src/routes/earnings.routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// ── CORS ──────────────────────────────────────────────────────────────
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:8080",
  "https://deusizisparkle.com",
  "https://www.deusizisparkle.com",
  process.env.CORS_ORIGIN,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: ${origin}`));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// ── Stripe raw-body webhooks MUST come BEFORE express.json() ──────────
app.post(
  "/api/payments/webhook/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhook,
);

app.post(
  "/api/subscriptions/webhook/stripe",
  express.raw({ type: "application/json" }),
  stripeSubscriptionWebhook,
);

// ── Body parsers ──────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── Attach DB + Redis to every request ───────────────────────────────
app.use((req, _res, next) => {
  req.db = pool;
  req.redis = redis;
  next();
});

// ── Static files ──────────────────────────────────────────────────────
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// ── API Routes ────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/maids", maidsRoutes);
app.use("/api/bookings", bookingsRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/leads", leadsRoutes);
app.use("/api/customer-support", customerSupportRoutes);
app.use("/api/maid-support", maidSupportRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/support-chat", supportChatRouter);
app.use("/api/maid-support-chat", maidSupportChatRouter);
app.use("/api/settings", settingsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/withdrawals", withdrawalsRoutes);
app.use("/api/subscriptions", subscriptionsRoutes);
app.use("/api/earnings", earningsRouter);

// ── Health check ──────────────────────────────────────────────────────
app.get("/health", async (_req, res) => {
  const status = { postgres: "ok", redis: "ok" };

  try {
    await pool.query("SELECT 1");
  } catch (e) {
    status.postgres = e.message;
  }

  try {
    await redis.ping().catch(() => {
      throw new Error("unavailable");
    });
  } catch (e) {
    status.redis = e.message;
  }

  const healthy = status.postgres === "ok" && status.redis === "ok";
  return res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "degraded",
    version: process.env.npm_package_version || "1.0.0",
    env: process.env.NODE_ENV || "development",
    ...status,
  });
});

// ── 404 ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "route not found" });
});

// ── Global error handler ──────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  res.status(err.status || 500).json({
    error:
      process.env.NODE_ENV === "production"
        ? "internal server error"
        : err.message,
  });
});

// ── Start ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✓ Deusizi Sparkle backend running on port ${PORT}`);
  console.log(`✓ Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`✓ CORS origins: ${allowedOrigins.join(", ")}`);
  console.log(`\n📍 API base: http://localhost:${PORT}/api`);
  console.log(`❤️  Health:   http://localhost:${PORT}/health\n`);
});

export { pool, redis };
