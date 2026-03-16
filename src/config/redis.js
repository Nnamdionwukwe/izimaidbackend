import { createClient } from "redis";

const redisUrl = process.env.REDIS_URL;
const isProduction = process.env.NODE_ENV === "production";

// Skip Redis entirely in development if no local Redis is running
if (!isProduction) {
  console.log("⚠️  Redis disabled in development — using no-op cache");
}

const useTLS = redisUrl?.startsWith("rediss://");

const client = createClient({
  url: redisUrl,
  socket: {
    tls: useTLS,
    rejectUnauthorized: false,
    connectTimeout: isProduction ? 10000 : 3000,
    reconnectStrategy: (retries) => {
      if (!isProduction || retries > 3) return false;
      return Math.min(retries * 500, 2000);
    },
  },
});

client.on("error", () => {});
client.on("connect", () => console.log("✓ Redis connected"));
client.on("ready", () => console.log("✓ Redis ready"));

if (isProduction) {
  client.connect().catch(() => {
    console.warn("⚠️  Could not connect to Redis — continuing without cache");
  });
}

const isReady = () => isProduction && client.isReady;

export const safeGet = async (key) => {
  if (!isReady()) return null;
  try {
    return await client.get(key);
  } catch {
    return null;
  }
};

export const safeSet = async (key, ttl, value) => {
  if (!isReady()) return;
  try {
    await client.setEx(key, ttl, value);
  } catch {}
};

export const safeDel = async (key) => {
  if (!isReady()) return;
  try {
    await client.del(key);
  } catch {}
};

export const safePing = async () => {
  if (!isReady()) return null;
  try {
    return await client.ping();
  } catch {
    return null;
  }
};

export default client;
