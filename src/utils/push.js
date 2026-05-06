// src/utils/push.js
// ─── Expo push notification sender ───────────────────────────────────
// npm install expo-server-sdk

import Expo from "expo-server-sdk";

const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

/**
 * Send a push notification to one or more users.
 *
 * @param {object} db          - pg pool/client
 * @param {string[]} userIds   - array of user UUIDs to notify
 * @param {object} payload     - { title, body, data, sound, priority }
 */
export async function sendPushToUsers(db, userIds, payload) {
  if (!userIds?.length) return;

  // Fetch all push tokens for these users
  const { rows } = await db.query(
    `SELECT token FROM push_tokens WHERE user_id = ANY($1)`,
    [userIds],
  );

  if (!rows.length) return;

  const messages = rows
    .map((r) => r.token)
    .filter(Expo.isExpoPushToken)
    .map((pushToken) => ({
      to: pushToken,
      sound: payload.sound ?? "default",
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      priority: payload.priority ?? "high",
      channelId: payload.channelId ?? "default",
    }));

  if (!messages.length) return;

  // Batch and send
  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
    } catch (err) {
      console.error("[push] send error:", err.message);
    }
  }
}

/**
 * Save or update a user's push token.
 * Called from POST /api/users/push-token
 */
export async function upsertPushToken(db, userId, token, platform) {
  await db.query(
    `INSERT INTO push_tokens (user_id, token, platform, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, token) DO UPDATE SET updated_at = now()`,
    [userId, token, platform || null],
  );
}
