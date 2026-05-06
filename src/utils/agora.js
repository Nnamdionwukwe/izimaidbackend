// src/utils/agora.js
// ─── Agora RTC token generator ────────────────────────────────────────
// npm install agora-token

import { RtcTokenBuilder, RtcRole } from "agora-token";

const APP_ID = process.env.AGORA_APP_ID;
const APP_CERT = process.env.AGORA_APP_CERTIFICATE;

/**
 * Generate an Agora RTC token.
 * @param {string} channelName  - unique channel (e.g. booking ID slice)
 * @param {string|number} uid   - 0 = Agora assigns one automatically
 * @param {number} expiresInSec - token lifetime in seconds (default 2h)
 */
export function generateAgoraToken(channelName, uid = 0, expiresInSec = 7200) {
  if (!APP_ID || !APP_CERT) {
    throw new Error(
      "AGORA_APP_ID and AGORA_APP_CERTIFICATE must be set in .env",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const expireTime = now + expiresInSec;

  const token = RtcTokenBuilder.buildTokenWithUid(
    APP_ID,
    APP_CERT,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    expireTime,
    expireTime,
  );

  return { token, channelName, appId: APP_ID, expireTime };
}
