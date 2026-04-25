// db/test-email.js — replace entire file
import dotenv from "dotenv";
dotenv.config();

import { sendEmail } from "../src/utils/mailer.js";

console.log("Testing with OAuth2:", !!process.env.GMAIL_CLIENT_ID);

const result = await sendEmail({
  to: process.env.SMTP_USER,
  subject: "Deusizi Sparkle — OAuth2 Test",
  html: "<h2>✅ OAuth2 Email Working!</h2><p>Production email is configured correctly.</p>",
});

console.log("Result:", result);
process.exit(0);
