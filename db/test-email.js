import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

console.log("SMTP config:");
console.log("  HOST:", process.env.SMTP_HOST);
console.log("  PORT:", process.env.SMTP_PORT);
console.log("  USER:", process.env.SMTP_USER);
console.log(
  "  PASS:",
  process.env.SMTP_PASS
    ? `${process.env.SMTP_PASS.slice(0, 4)}****`
    : "NOT SET",
);
console.log("  FROM:", process.env.EMAIL_FROM);

// Change in scripts/test-email.js:
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, // ← SSL for port 465
  family: 4,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: { rejectUnauthorized: false },
});

console.log("\nVerifying SMTP connection...");

try {
  await transporter.verify();
  console.log("✅ SMTP connection verified!");

  console.log("\nSending test email...");
  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.SMTP_USER,
    subject: "Deusizi Sparkle — SMTP Test",
    text: "If you see this, email is working correctly!",
    html: "<h2>✅ Email is working!</h2><p>Deusizi Sparkle SMTP test passed.</p>",
  });

  console.log("✅ Email sent! Message ID:", info.messageId);
  console.log("Check your Gmail inbox for the test email.");
} catch (err) {
  console.error("❌ SMTP Error:", err.message);
  console.error("\nFull error:", err);

  if (
    err.message.includes("535") ||
    err.message.includes("Invalid login") ||
    err.message.includes("Username and Password")
  ) {
    console.error("\n💡 Fix: Your Gmail App Password is wrong or expired.");
    console.error("   1. Go to myaccount.google.com/security");
    console.error("   2. Enable 2-Step Verification");
    console.error("   3. Search 'App passwords' → create new one");
    console.error(
      "   4. Update SMTP_PASS in .env with the new 16-char password",
    );
  }
  if (err.message.includes("EHOSTUNREACH")) {
    console.error(
      "\n💡 Fix: IPv6 issue — family:4 should fix this. Check your network.",
    );
  }
}

process.exit(0);
