// src/utils/agora.js
import AgoraToken from "agora-token";

const { RtcTokenBuilder, RtcRole } = AgoraToken;

const APP_ID = process.env.AGORA_APP_ID;
const APP_CERT = process.env.AGORA_APP_CERTIFICATE;

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
