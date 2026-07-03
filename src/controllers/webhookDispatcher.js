// src/controllers/webhookDispatcher.js
import { flutterwaveWebhook as paymentsWebhook } from "./payments.js";
import { flutterwaveSubscriptionWebhook } from "./subscriptions.controller.js";
import { webhook as foundationWebhook } from "./foundation.controller.js";
import { webhook as giftCertificateWebhook } from "./giftCertificate.controller.js";

const FLW_SECRET_HASH = process.env.FLW_SECRET_HASH;

export const unifiedWebhook = async (req, res) => {
  const signature = req.headers["verif-hash"];
  if (!signature || signature !== FLW_SECRET_HASH) {
    return res.status(401).json({ error: "invalid signature" });
  }

  const { event, data } = req.body;
  if (event !== "charge.completed") {
    return res.sendStatus(200);
  }

  const tx_ref = data?.tx_ref;
  if (!tx_ref) {
    return res.sendStatus(200);
  }

  // Route based on tx_ref prefix
  if (tx_ref.startsWith("ds_sub_")) {
    return flutterwaveSubscriptionWebhook(req, res);
  } else if (tx_ref.startsWith("FD-")) {
    return foundationWebhook(req, res);
  } else if (tx_ref.startsWith("GIFT-")) {
    return giftCertificateWebhook(req, res);
  } else {
    // General booking payment
    return paymentsWebhook(req, res);
  }
};
