import { createClient } from "redis";

const redisUrl = process.env.REDIS_URL;

// Only use TLS if the URL itself uses rediss:// protocol
const useTLS = redisUrl?.startsWith("rediss://");

const client = createClient({
  url: redisUrl,
  socket: {
    tls: useTLS,
    rejectUnauthorized: false,
    connectTimeout: 5000,
    reconnectStrategy: (retries) => {
      if (retries > 3) {
        console.log("⚠️  Redis unavailable — continuing without cache");
        return false;
      }
      return Math.min(retries * 500, 2000);
    },
  },
});

client.on("error", (err) => {
  if (err.code === "ETIMEDOUT" || err.code === "ECONNREFUSED") {
    console.warn("⚠️  Redis connection failed — cache disabled");
  } else {
    console.error("✗ Redis client error:", err.message);
  }
});

client.on("connect", () => console.log("✓ Redis connected"));
client.on("ready", () => console.log("✓ Redis ready"));

client.connect().catch(() => {
  console.warn("⚠️  Could not connect to Redis — continuing without cache");
});

export const safeGet = async (key) => {
  try {
    return await client.get(key);
  } catch {
    return null;
  }
};

export const safeSet = async (key, ttl, value) => {
  try {
    await client.setEx(key, ttl, value);
  } catch {}
};

export const safeDel = async (key) => {
  try {
    await client.del(key);
  } catch {}
};

export const safePing = async () => {
  try {
    return await client.ping();
  } catch {
    return null;
  }
};

export default client;
