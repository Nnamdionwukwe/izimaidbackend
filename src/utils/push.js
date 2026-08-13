// src/utils/push.js

import Expo from "expo-server-sdk";

// Create a new Expo SDK client
// Optional: Provide access token if you have one
const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

/**
 * Send a push notification to one or more users.
 *
 * @param {object} db          - pg pool/client
 * @param {string[]} userIds   - array of user UUIDs to notify
 * @param {object} payload     - { title, body, data, sound, priority, channelId }
 */
export async function sendPushToUsers(db, userIds, payload) {
  if (!userIds?.length) {
    console.log("No user IDs provided");
    return;
  }

  try {
    // Fetch all push tokens for these users
    const { rows } = await db.query(
      `SELECT token FROM push_tokens WHERE user_id = ANY($1) AND is_active = true`,
      [userIds],
    );

    if (!rows.length) {
      console.log(`No push tokens found for users: ${userIds.join(", ")}`);
      return;
    }

    // Filter valid Expo push tokens
    const messages = rows
      .map((r) => r.token)
      .filter((token) => Expo.isExpoPushToken(token))
      .map((pushToken) => ({
        to: pushToken,
        sound: payload.sound ?? "default",
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
        priority: payload.priority ?? "high",
        channelId: payload.channelId ?? "default",
        badge: payload.badge ?? 1,
      }));

    if (!messages.length) {
      console.log("No valid Expo push tokens found");
      return;
    }

    // Batch and send
    const chunks = expo.chunkPushNotifications(messages);
    const receipts = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        receipts.push(...ticketChunk);
        console.log(`✅ Sent ${chunk.length} push notifications`);
      } catch (err) {
        console.error("[push] send error:", err.message);
      }
    }

    // Handle receipts (optional - check for errors)
    // You can implement receipt handling if needed

    return receipts;
  } catch (err) {
    console.error("[push] Error sending notifications:", err.message);
  }
}

/**
 * Save or update a user's push token.
 * Called from POST /api/users/push-token
 */
export async function upsertPushToken(db, userId, token, platform) {
  try {
    await db.query(
      `INSERT INTO push_tokens (user_id, token, platform, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, true, now(), now())
       ON CONFLICT (user_id, token) DO UPDATE 
       SET platform = $3, is_active = true, updated_at = now()`,
      [userId, token, platform || null],
    );
    console.log(`✅ Push token upserted for user ${userId}`);
  } catch (err) {
    console.error("Error upserting push token:", err);
    throw err;
  }
}

/**
 * Remove a user's push token (soft delete - mark inactive)
 */
export async function deactivatePushToken(db, userId, token) {
  try {
    await db.query(
      `UPDATE push_tokens
       SET is_active = false, updated_at = now()
       WHERE user_id = $1 AND token = $2`,
      [userId, token],
    );
    console.log(`🗑️ Push token deactivated for user ${userId}`);
  } catch (err) {
    console.error("Error deactivating push token:", err);
    throw err;
  }
}
