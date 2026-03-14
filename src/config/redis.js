import { createClient } from "redis";

const redisUrl = process.env.REDIS_URL;
const isProduction = process.env.NODE_ENV === "production";

const isInternalUrl =
  redisUrl?.includes("railway.internal") || redisUrl?.includes("localhost");

const client = createClient({
  url: redisUrl,
  socket: {
    tls: isProduction && !isInternalUrl,
    rejectUnauthorized: false,
  },
});

client.on("error", (err) => {
  console.error("✗ Redis client error:", err);
});

client.on("connect", () => {
  console.log("✓ Redis connected");
});

client.on("ready", () => {
  console.log("✓ Redis ready");
});

client.connect().catch((err) => {
  console.error("✗ Failed to connect to Redis:", err);
  console.log("⚠️  Continuing without Redis cache...");
});

export default client;
