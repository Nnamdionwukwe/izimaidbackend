import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import pool from "./src/config/database.js";
import redis from "./src/config/redis.js";

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
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

app.use("/api/payments/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

app.use((req, _res, next) => {
  req.db = pool;
  req.redis = redis;
  next();
});

// ✅ Serve static files for avatar uploads
// This allows accessing uploaded images at: http://localhost:8080/uploads/avatars/filename.jpg
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/maids", maidsRoutes);
app.use("/api/bookings", bookingsRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/leads", leadsRoutes);
app.use("/api/customer-support", customerSupportRoutes); // ← ADD THIS LINE
app.use("/api/maid-support", maidSupportRoutes); // ← ADD THIS LINE
app.use("/api/chat", chatRoutes);
app.use("/api/support-chat", supportChatRouter);
app.use("/api/maid-support-chat", maidSupportChatRouter);

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
  console.log(
    `📸 Avatar uploads available at: http://localhost:${PORT}/uploads/avatars`,
  );
});

export { pool, redis };
