import { google } from "googleapis";
import nodemailer from "nodemailer";

const APP_NAME = process.env.APP_NAME || "Deusizi Sparkle";
const FRONTEND =
  process.env.CLIENT_URL || process.env.FRONTEND_URL || "http://localhost:5173";

// ── Send via Gmail REST API (no SMTP — works on Railway) ──────────────
async function sendViaGmailAPI({ to, subject, html }) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground",
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const from = `${APP_NAME} <${process.env.SMTP_USER}>`;
  const messageParts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    html,
  ];
  const message = messageParts.join("\n");
  const encoded = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });
  return res.data.id;
}

// ── Send via SMTP (local dev fallback) ────────────────────────────────
async function sendViaSMTP({ to, subject, html }) {
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    family: 4,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: { rejectUnauthorized: false },
  });
  const info = await transport.sendMail({
    from: `${APP_NAME} <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
  return info.messageId;
}

// ── Base send — auto picks Gmail API or SMTP ──────────────────────────
export async function sendEmail({ to, subject, html }) {
  try {
    const useGmailAPI = !!(
      process.env.GMAIL_CLIENT_ID &&
      process.env.GMAIL_CLIENT_SECRET &&
      process.env.GMAIL_REFRESH_TOKEN
    );

    const id = useGmailAPI
      ? await sendViaGmailAPI({ to, subject, html })
      : await sendViaSMTP({ to, subject, html });

    console.log(
      `✓ [EMAIL] ${subject} → ${to} (${useGmailAPI ? "Gmail API" : "SMTP"})`,
    );
    return { success: true, id };
  } catch (err) {
    console.error(`✗ [EMAIL] Failed → ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ── transporter shim — used by bookings.js triggerSOS ─────────────────
export const transporter = {
  sendMail: async ({ to, subject, html }) => {
    return sendEmail({ to, subject, html });
  },
  verify: async () => true,
};

// Startup log
if (process.env.GMAIL_CLIENT_ID) {
  console.log("✓ Gmail API ready (no SMTP)");
} else {
  console.log("✓ Gmail SMTP ready (local)");
}

// ── All existing email functions unchanged below ───────────────────────
// ── Shared styles ─────────────────────────────────────────────────────
const wrap = (content) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
            background:#f1f5f9;padding:40px 16px">
  <div style="max-width:520px;margin:0 auto;background:#fff;
              border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);overflow:hidden">
    <div style="background:#1e3a8a;padding:24px 32px">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">${APP_NAME}</h1>
    </div>
    <div style="padding:32px">${content}</div>
    <div style="padding:16px 32px;border-top:1px solid #e2e8f0;background:#f8fafc">
      <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center">
        © ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
      </p>
    </div>
  </div>
</div>`;

const btn = (text, href, color = "#1e3a8a") => `
<a href="${href}" style="display:inline-block;margin:24px 0;padding:12px 32px;
   background:${color};color:#fff;border-radius:8px;text-decoration:none;
   font-weight:600;font-size:15px">${text}</a>`;

const row = (label, value, shade) => `
<tr style="background:${shade ? "#f8fafc" : "#fff"}">
  <td style="padding:10px 12px;color:#64748b;font-size:13px;
             border:1px solid #e2e8f0;width:130px">${label}</td>
  <td style="padding:10px 12px;font-size:13px;border:1px solid #e2e8f0">${value}</td>
</tr>`;

const table = (...rows) => `
<table style="width:100%;border-collapse:collapse;margin:16px 0">${rows.join("")}</table>`;

// ══════════════════════════════════════════════════════════════════════
//  AUTH EMAILS
// ══════════════════════════════════════════════════════════════════════

export async function sendVerificationEmail(user, token) {
  const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
  return sendEmail({
    to: user.email,
    subject: `Verify your ${APP_NAME} account`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Welcome, ${user.name}! 👋</h2>
      <p style="color:#475569;line-height:1.6">
        Thanks for signing up. Please verify your email address to activate your account.
      </p>
      ${btn("Verify Email Address", verifyUrl)}
      <p style="color:#94a3b8;font-size:13px">
        This link expires in <strong>24 hours</strong>.
        If you didn't create an account, ignore this email.
      </p>
      <p style="color:#cbd5e1;font-size:11px;word-break:break-all">Or copy: ${verifyUrl}</p>
    `),
  });
}

export async function sendNewLoginAlert(user, { ip, device }) {
  return sendEmail({
    to: user.email,
    subject: `New login to your ${APP_NAME} account`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">New login detected 🔐</h2>
      <p style="color:#475569;line-height:1.6">
        Hi ${user.name}, we noticed a new login from a device we haven't seen before.
      </p>
      ${table(
        row("Device", device, false),
        row("IP", ip, true),
        row("Time", new Date().toUTCString(), false),
      )}
      <p style="color:#475569;font-size:14px">
        If this was you, no action needed. If not,
        <a href="${FRONTEND}/reset-password" style="color:#1e3a8a;font-weight:600">
          reset your password immediately</a>.
      </p>
    `),
  });
}

export async function sendPasswordResetEmail(user, token) {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  return sendEmail({
    to: user.email,
    subject: `Reset your ${APP_NAME} password`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Password Reset 🔑</h2>
      <p style="color:#475569;line-height:1.6">
        Hi ${user.name}, click below to reset your password.
      </p>
      ${btn("Reset Password", resetUrl)}
      <p style="color:#94a3b8;font-size:13px">
        Expires in <strong>1 hour</strong>. Ignore if you didn't request this.
      </p>
    `),
  });
}

// export async function sendWelcomeEmail(user) {
//   const dashLink = `${FRONTEND}/${user.role === "maid" ? "maid" : "customer"}/dashboard`;
//   return sendEmail({
//     to: user.email,
//     subject: `Welcome to ${APP_NAME} — your account is verified! 🎉`,
//     html: wrap(`
//       <h2 style="color:#1e293b;margin:0 0 8px">You're all set, ${user.name}! 🎉</h2>
//       <p style="color:#475569;line-height:1.6">
//         Your email has been verified and your ${APP_NAME} account is active.
//         ${
//           user.role === "maid"
//             ? "Complete your profile to start receiving bookings."
//             : "Browse available maids and book your first cleaning service."
//         }
//       </p>
//       ${btn("Go to Dashboard", dashLink)}
//     `),
//   });
// }

export async function sendWelcomeEmail(user) {
  return sendEmail({
    to: user.email,
    subject: `Welcome to ${process.env.APP_NAME || "Deusizi Sparkle"}! 🎉`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#faf7f4;border-radius:12px;">
        <h1 style="font-size:28px;color:#1a1208;margin:0 0 8px;">Welcome, ${user.name}! 👋</h1>
        <p style="color:#8a7b6a;font-size:15px;line-height:1.6;">
          Your email has been verified. Your account is ready.
        </p>
        <p style="color:#8a7b6a;font-size:15px;line-height:1.6;">
          You can now book trusted cleaning professionals near you.
        </p>
        <a href="${process.env.FRONTEND_URL}"
           style="display:inline-block;margin-top:24px;padding:14px 28px;background:#1a1208;color:#f5ede0;border-radius:8px;text-decoration:none;font-size:15px;font-weight:500;">
          Get started →
        </a>
        <hr style="margin:32px 0;border:none;border-top:1px solid #e0d8ce;" />
        <p style="color:#b5a898;font-size:12px;">
          Deusizi Sparkle · Abuja, Lagos, Nigeria
        </p>
      </div>
    `,
  });
}

// ══════════════════════════════════════════════════════════════════════
//  BOOKING EMAILS
// ══════════════════════════════════════════════════════════════════════

export async function sendBookingConfirmation(customer, booking, maid) {
  return sendEmail({
    to: customer.email,
    subject: `Booking confirmed — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Booking Confirmed ✅</h2>
      <p style="color:#475569">Hi ${customer.name}, your booking has been confirmed.</p>
      ${table(
        row("Maid", maid.name, false),
        row("Date", new Date(booking.service_date).toDateString(), true),
        row("Duration", `${booking.duration_hours} hour(s)`, false),
        row("Address", booking.address, true),
        row(
          "Total",
          `₦${Number(booking.total_amount).toLocaleString()}`,
          false,
        ),
      )}
      ${btn("View Booking", `${FRONTEND}/bookings/${booking.id}`)}
    `),
  });
}

export async function sendNewBookingToMaid(maid, booking, customer) {
  return sendEmail({
    to: maid.email,
    subject: `New booking request — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">New Booking! 🎉</h2>
      <p style="color:#475569">Hi ${maid.name}, you have a new confirmed booking.</p>
      ${table(
        row("Customer", customer.name, false),
        row("Date", new Date(booking.service_date).toDateString(), true),
        row("Duration", `${booking.duration_hours} hour(s)`, false),
        row("Address", booking.address, true),
        row(
          "Earnings",
          `₦${Number(booking.total_amount).toLocaleString()}`,
          false,
        ),
      )}
      ${btn("View Booking", `${FRONTEND}/bookings/${booking.id}`)}
    `),
  });
}

export async function sendBookingCancelledEmail(
  recipient,
  booking,
  cancelledBy,
  reason,
) {
  return sendEmail({
    to: recipient.email,
    subject: `Booking cancelled — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#dc2626;margin:0 0 8px">Booking Cancelled ❌</h2>
      <p style="color:#475569">
        Hi ${recipient.name}, your booking for
        <strong>${new Date(booking.service_date).toDateString()}</strong>
        has been cancelled by <strong>${cancelledBy}</strong>.
      </p>
      ${reason ? `<p style="color:#475569"><strong>Reason:</strong> ${reason}</p>` : ""}
      ${btn("View Details", `${FRONTEND}/bookings/${booking.id}`, "#dc2626")}
    `),
  });
}

export async function sendBookingReminderEmail(
  recipient,
  booking,
  otherPartyName,
  role,
) {
  return sendEmail({
    to: recipient.email,
    subject: `Booking reminder — tomorrow at ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Booking Reminder 🗓️</h2>
      <p style="color:#475569">
        Hi ${recipient.name}, this is a reminder about your booking tomorrow.
      </p>
      ${table(
        row(role === "customer" ? "Maid" : "Customer", otherPartyName, false),
        row("Date", new Date(booking.service_date).toDateString(), true),
        row("Duration", `${booking.duration_hours} hour(s)`, false),
        row("Address", booking.address, true),
      )}
      ${btn("View Booking", `${FRONTEND}/bookings/${booking.id}`)}
    `),
  });
}

export async function sendCheckInEmail(customer, maid, booking) {
  return sendEmail({
    to: customer.email,
    subject: `${maid.name} has checked in — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Your maid has arrived 🏠</h2>
      <p style="color:#475569">
        Hi ${customer.name}, <strong>${maid.name}</strong> has checked in and started your cleaning service.
      </p>
      ${table(
        row("Maid", maid.name, false),
        row("Time", new Date().toLocaleTimeString(), true),
        row("Address", booking.address, false),
      )}
      ${btn("Track Live", `${FRONTEND}/bookings/${booking.id}/track`)}
    `),
  });
}

export async function sendCheckOutEmail(customer, maid, booking) {
  return sendEmail({
    to: customer.email,
    subject: `Cleaning completed — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#16a34a;margin:0 0 8px">Service Completed ✅</h2>
      <p style="color:#475569">
        Hi ${customer.name}, <strong>${maid.name}</strong> has completed your cleaning service.
      </p>
      ${table(
        row("Duration", `${booking.duration_hours} hour(s)`, false),
        row("Address", booking.address, true),
        row("Completed", new Date().toLocaleTimeString(), false),
      )}
      <p style="color:#475569">Please rate your experience!</p>
      ${btn("Leave a Review", `${FRONTEND}/bookings/${booking.id}/review`)}
    `),
  });
}

export async function sendReviewReceivedEmail(maid, review, customerName) {
  const stars = "⭐".repeat(review.rating);
  return sendEmail({
    to: maid.email,
    subject: `You received a ${review.rating}-star review — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">New Review ${stars}</h2>
      <p style="color:#475569">
        Hi ${maid.name}, <strong>${customerName}</strong> left you a review.
      </p>
      ${table(
        row("Rating", `${review.rating}/5 ${stars}`, false),
        row("Comment", review.comment || "No comment", true),
      )}
      ${btn("View Profile", `${FRONTEND}/maid/profile`)}
    `),
  });
}

// ══════════════════════════════════════════════════════════════════════
//  SOS / EMERGENCY EMAILS
// ══════════════════════════════════════════════════════════════════════

export async function sendSOSEmail(
  recipients,
  { triggeredBy, booking, lat, lng, address, message },
) {
  const mapLink =
    lat && lng
      ? `<a href="https://maps.google.com/?q=${lat},${lng}" style="color:#dc2626;font-weight:600">
         View on Google Maps →</a>`
      : "";
  const html = wrap(`
    <div style="background:#fee2e2;border:2px solid #dc2626;border-radius:8px;
                padding:16px;margin-bottom:24px">
      <h2 style="color:#dc2626;margin:0">🚨 SOS ALERT TRIGGERED</h2>
    </div>
    <p style="color:#475569">An SOS alert has been triggered during an active booking.</p>
    ${table(
      row("Triggered by", triggeredBy, false),
      row("Customer", booking.customer_name, true),
      row("Maid", booking.maid_name, false),
      row("Address", address || booking.address, true),
      row("Time", new Date().toUTCString(), false),
    )}
    ${message ? `<p style="color:#475569"><strong>Message:</strong> ${message}</p>` : ""}
    ${mapLink ? `<p style="margin:16px 0">${mapLink}</p>` : ""}
    ${btn("View Booking", `${FRONTEND}/admin/bookings/${booking.id}`, "#dc2626")}
  `);

  for (const r of recipients) {
    sendEmail({
      to: r.email,
      subject: `🚨 SOS ALERT — ${APP_NAME}`,
      html,
    }).catch(console.error);
  }
}

export async function sendSOSResolvedEmail(recipients, booking) {
  const html = wrap(`
    <h2 style="color:#16a34a;margin:0 0 8px">SOS Alert Resolved ✅</h2>
    <p style="color:#475569">
      The SOS alert for the booking on
      <strong>${new Date(booking.service_date).toDateString()}</strong>
      has been resolved by an admin.
    </p>
    ${btn("View Booking", `${FRONTEND}/bookings/${booking.id}`)}
  `);
  for (const r of recipients) {
    sendEmail({
      to: r.email,
      subject: `SOS Alert Resolved — ${APP_NAME}`,
      html,
    }).catch(console.error);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  PAYMENT EMAILS
// ══════════════════════════════════════════════════════════════════════

export async function sendPaymentReceipt(customer, booking, payment) {
  return sendEmail({
    to: customer.email,
    subject: `Payment receipt — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Payment Received 💳</h2>
      <p style="color:#475569">Hi ${customer.name}, your payment has been received.</p>
      ${table(
        row(
          "Reference",
          payment.paystack_reference || payment.stripe_payment_id || "N/A",
          false,
        ),
        row("Amount", `₦${Number(payment.amount).toLocaleString()}`, true),
        row(
          "Date",
          new Date(payment.paid_at || Date.now()).toUTCString(),
          false,
        ),
        row("Gateway", payment.gateway || "card", true),
        row("Status", "Paid ✓", false),
      )}
      <p style="color:#94a3b8;font-size:13px">
        Your booking is awaiting admin approval. You'll be notified once confirmed.
      </p>
      ${btn("View Booking", `${FRONTEND}/bookings/${booking.id}`)}
    `),
  });
}

export async function sendBookingApprovedEmail(customer, booking, maid) {
  return sendEmail({
    to: customer.email,
    subject: `Booking approved — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#16a34a;margin:0 0 8px">Booking Approved! ✅</h2>
      <p style="color:#475569">
        Hi ${customer.name}, your booking has been approved and your maid has been notified.
      </p>
      ${table(
        row("Maid", maid.name, false),
        row("Date", new Date(booking.service_date).toDateString(), true),
        row("Duration", `${booking.duration_hours} hour(s)`, false),
        row("Address", booking.address, true),
      )}
      ${btn("View Booking", `${FRONTEND}/bookings/${booking.id}`)}
    `),
  });
}

export async function sendRefundEmail(customer, booking, amount, reason) {
  return sendEmail({
    to: customer.email,
    subject: `Refund initiated — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Refund Initiated 💰</h2>
      <p style="color:#475569">
        Hi ${customer.name}, a refund has been initiated for your cancelled booking.
      </p>
      ${table(
        row("Amount", `₦${Number(amount).toLocaleString()}`, false),
        row("Reason", reason || "Booking cancelled", true),
        row("Date", new Date().toUTCString(), false),
      )}
      <p style="color:#94a3b8;font-size:13px">
        Refunds typically take 3–10 business days depending on your bank.
      </p>
      ${btn("View Details", `${FRONTEND}/bookings/${booking.id}`)}
    `),
  });
}

export async function sendBankTransferInstructions(
  customer,
  booking,
  transferDetails,
) {
  return sendEmail({
    to: customer.email,
    subject: `Bank transfer instructions — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Bank Transfer Instructions 🏦</h2>
      <p style="color:#475569">
        Hi ${customer.name}, please transfer the exact amount below to complete your booking.
      </p>
      ${table(
        row(
          "Amount",
          `₦${Number(transferDetails.amount).toLocaleString()}`,
          false,
        ),
        row("Bank", transferDetails.bank_name, true),
        row("Account Number", transferDetails.account_number, false),
        row("Account Name", transferDetails.account_name, true),
        row("Reference", transferDetails.reference, false),
      )}
      <p style="color:#dc2626;font-size:13px;font-weight:600">
        ⚠️ Use the reference number as your payment narration.
        Upload your proof of payment after transfer.
      </p>
      ${btn("Upload Proof", `${FRONTEND}/bookings/${booking.id}/payment`)}
    `),
  });
}

export async function sendBankTransferVerifiedEmail(
  customer,
  booking,
  approved,
) {
  const color = approved ? "#16a34a" : "#dc2626";
  const icon = approved ? "✅" : "❌";
  return sendEmail({
    to: customer.email,
    subject: `Bank transfer ${approved ? "verified" : "rejected"} — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:${color};margin:0 0 8px">
        Transfer ${approved ? "Verified" : "Rejected"} ${icon}
      </h2>
      <p style="color:#475569">
        Hi ${customer.name}, your bank transfer has been
        <strong>${approved ? "verified" : "rejected"}</strong>.
        ${
          approved
            ? "Your booking is now awaiting admin approval."
            : "The amount has not been credited. Please contact support."
        }
      </p>
      ${btn("View Booking", `${FRONTEND}/bookings/${booking.id}`)}
    `),
  });
}

// ══════════════════════════════════════════════════════════════════════
//  WITHDRAWAL EMAILS
// ══════════════════════════════════════════════════════════════════════

export async function sendWithdrawalRequestedEmail(maid, withdrawal) {
  return sendEmail({
    to: maid.email,
    subject: `Withdrawal request received — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Withdrawal Request Received 💸</h2>
      <p style="color:#475569">
        Hi ${maid.name}, your withdrawal request has been received and is being reviewed.
      </p>
      ${table(
        row(
          "Amount",
          `${withdrawal.currency} ${Number(withdrawal.amount).toLocaleString()}`,
          false,
        ),
        row(
          "Fee",
          `${withdrawal.currency} ${Number(withdrawal.fee).toLocaleString()}`,
          true,
        ),
        row(
          "You receive",
          `${withdrawal.currency} ${Number(withdrawal.net_amount).toLocaleString()}`,
          false,
        ),
        row("Method", withdrawal.method.replace(/_/g, " "), true),
        row("Status", "Pending review", false),
      )}
      <p style="color:#94a3b8;font-size:13px">
        Withdrawals are processed within 24 hours on business days.
      </p>
      ${btn("View Wallet", `${FRONTEND}/maid/wallet`)}
    `),
  });
}

export async function sendWithdrawalStatusEmail(
  maid,
  withdrawal,
  status,
  gatewayRef,
  failureReason,
) {
  const statusConfig = {
    processing: {
      color: "#0284c7",
      icon: "⏳",
      title: "Withdrawal Processing",
      body: "Your withdrawal is being processed and will arrive soon.",
    },
    paid: {
      color: "#16a34a",
      icon: "✅",
      title: "Withdrawal Paid",
      body: `Your withdrawal has been sent. Reference: <strong>${gatewayRef || "N/A"}</strong>.`,
    },
    rejected: {
      color: "#dc2626",
      icon: "❌",
      title: "Withdrawal Rejected",
      body: `Reason: ${failureReason || "Contact support"}. Amount returned to wallet.`,
    },
    failed: {
      color: "#dc2626",
      icon: "❌",
      title: "Withdrawal Failed",
      body: `Reason: ${failureReason || "Contact support"}. Amount returned to wallet.`,
    },
    cancelled: {
      color: "#64748b",
      icon: "🚫",
      title: "Withdrawal Cancelled",
      body: "Your withdrawal has been cancelled. Amount returned to wallet.",
    },
  };

  const cfg = statusConfig[status] || statusConfig.processing;

  return sendEmail({
    to: maid.email,
    subject: `${cfg.title} — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:${cfg.color};margin:0 0 8px">${cfg.icon} ${cfg.title}</h2>
      <p style="color:#475569">Hi ${maid.name}, ${cfg.body}</p>
      ${table(
        row(
          "Amount",
          `${withdrawal.currency} ${Number(withdrawal.amount).toLocaleString()}`,
          false,
        ),
        row("Method", withdrawal.method.replace(/_/g, " "), true),
        row("Status", status, false),
      )}
      ${btn("View Wallet", `${FRONTEND}/maid`)}
    `),
  });
}

export async function sendWithdrawalAdminAlertEmail(admins, maid, withdrawal) {
  const html = wrap(`
    <h2 style="color:#1e293b;margin:0 0 8px">New Withdrawal Request 💸</h2>
    <p style="color:#475569">A maid has submitted a withdrawal request.</p>
    ${table(
      row("Maid", maid.name, false),
      row("Email", maid.email, true),
      row(
        "Amount",
        `${withdrawal.currency} ${Number(withdrawal.amount).toLocaleString()}`,
        false,
      ),
      row("Method", withdrawal.method.replace(/_/g, " "), true),
      row(
        "Net Payout",
        `${withdrawal.currency} ${Number(withdrawal.net_amount).toLocaleString()}`,
        false,
      ),
    )}
    ${btn("Review in Admin", `${FRONTEND}/admin/withdrawals`)}
  `);

  for (const admin of admins) {
    sendEmail({
      to: admin.email,
      subject: `New withdrawal request — ${APP_NAME}`,
      html,
    }).catch(console.error);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  SUPPORT EMAILS
// ══════════════════════════════════════════════════════════════════════

export async function sendSupportTicketCreatedEmail(user, ticket) {
  return sendEmail({
    to: user.email,
    subject: `Support ticket #${ticket.id.slice(0, 8)} created — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Support Ticket Created 🎫</h2>
      <p style="color:#475569">Hi ${user.name}, we received your support request.</p>
      ${table(
        row("Ticket ID", `#${ticket.id.slice(0, 8)}`, false),
        row("Subject", ticket.subject, true),
        row("Category", ticket.category, false),
        row("Priority", ticket.priority, true),
        row("Status", "Open", false),
      )}
      <p style="color:#94a3b8;font-size:13px">
        Our team typically responds within 24 hours.
      </p>
      ${btn("View Ticket", `${FRONTEND}/support/tickets/${ticket.id}`)}
    `),
  });
}

export async function sendSupportTicketReplyEmail(user, ticket, replierName) {
  return sendEmail({
    to: user.email,
    subject: `New reply on ticket #${ticket.id.slice(0, 8)} — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">New Reply on Your Ticket 💬</h2>
      <p style="color:#475569">
        Hi ${user.name}, <strong>${replierName}</strong> replied to your support ticket.
      </p>
      ${table(
        row("Ticket", ticket.subject, false),
        row("Status", ticket.status, true),
      )}
      ${btn("View Reply", `${FRONTEND}/support/tickets/${ticket.id}`)}
    `),
  });
}

export async function sendSupportTicketStatusEmail(user, ticket, newStatus) {
  const statusConfig = {
    in_progress: { color: "#0284c7", icon: "⏳", text: "is being worked on" },
    resolved: { color: "#16a34a", icon: "✅", text: "has been resolved" },
    closed: { color: "#64748b", icon: "🔒", text: "has been closed" },
  };
  const cfg = statusConfig[newStatus] || {
    color: "#1e293b",
    icon: "📋",
    text: `is now ${newStatus}`,
  };

  return sendEmail({
    to: user.email,
    subject: `Ticket ${newStatus} — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:${cfg.color};margin:0 0 8px">${cfg.icon} Ticket Update</h2>
      <p style="color:#475569">
        Hi ${user.name}, your support ticket "<strong>${ticket.subject}</strong>" ${cfg.text}.
      </p>
      ${btn("View Ticket", `${FRONTEND}/support/tickets/${ticket.id}`)}
    `),
  });
}

// ══════════════════════════════════════════════════════════════════════
//  MAID DOCUMENT / VERIFICATION EMAILS
// ══════════════════════════════════════════════════════════════════════

export async function sendDocumentSubmittedEmail(maid, docType) {
  return sendEmail({
    to: maid.email,
    subject: `Document submitted for review — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Document Submitted 📄</h2>
      <p style="color:#475569">
        Hi ${maid.name}, your <strong>${docType.replace(/_/g, " ")}</strong>
        has been submitted and is under review.
      </p>
      <p style="color:#94a3b8;font-size:13px">
        Verification typically takes 1–2 business days.
      </p>
      ${btn("View Profile", `${FRONTEND}/maid/profile`)}
    `),
  });
}

export async function sendDocumentReviewedEmail(
  maid,
  docType,
  status,
  adminNotes,
) {
  const approved = status === "approved";
  return sendEmail({
    to: maid.email,
    subject: `Document ${status} — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:${approved ? "#16a34a" : "#dc2626"};margin:0 0 8px">
        ${approved ? "✅" : "❌"} Document ${approved ? "Approved" : "Rejected"}
      </h2>
      <p style="color:#475569">
        Hi ${maid.name}, your <strong>${docType.replace(/_/g, " ")}</strong>
        has been <strong>${status}</strong>.
        ${
          approved
            ? "Your profile is now verified."
            : "Please re-upload the correct document."
        }
      </p>
      ${adminNotes ? `<p style="color:#475569"><strong>Notes:</strong> ${adminNotes}</p>` : ""}
      ${btn("View Profile", `${FRONTEND}/maid/profile`)}
    `),
  });
}

// ADD to bottom of src/utils/mailer.js:

export async function sendSubscriptionConfirmationEmail(
  user,
  plan,
  subscription,
) {
  return sendEmail({
    to: user.email,
    subject: `${plan.display_name} subscription activated — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Subscription Activated 🎉</h2>
      <p style="color:#475569">
        Hi ${user.name}, your <strong>${plan.display_name}</strong> subscription is now active.
      </p>
      ${table(
        row("Plan", plan.display_name, false),
        row(
          "Price",
          `${subscription.currency} ${Number(subscription.amount).toLocaleString()}/${subscription.interval}`,
          true,
        ),
        row(
          "Started",
          new Date(subscription.current_period_start).toDateString(),
          false,
        ),
        row(
          "Next billing",
          new Date(subscription.current_period_end).toDateString(),
          true,
        ),
        row("Status", "Active ✓", false),
      )}
      <p style="color:#475569;font-size:14px">
        <strong>Your benefits:</strong>
      </p>
      <ul style="color:#475569;font-size:14px;line-height:1.8">
        ${(plan.features || []).map((f) => `<li>${f}</li>`).join("")}
      </ul>
      ${btn("Go to Dashboard", `${FRONTEND}/dashboard`)}
    `),
  });
}

export async function sendSubscriptionRenewalEmail(
  user,
  plan,
  subscription,
  invoice,
) {
  return sendEmail({
    to: user.email,
    subject: `Subscription renewed — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Subscription Renewed ✅</h2>
      <p style="color:#475569">
        Hi ${user.name}, your <strong>${plan.display_name}</strong> subscription has been renewed.
      </p>
      ${table(
        row("Plan", plan.display_name, false),
        row(
          "Amount charged",
          `${invoice.currency} ${Number(invoice.amount).toLocaleString()}`,
          true,
        ),
        row(
          "Period",
          `${new Date(invoice.period_start).toDateString()} → ${new Date(invoice.period_end).toDateString()}`,
          false,
        ),
        row("Status", "Active ✓", true),
      )}
      ${btn("View Subscription", `${FRONTEND}/settings/subscription`)}
    `),
  });
}

export async function sendSubscriptionCancelledEmail(user, plan, subscription) {
  const endDate = new Date(subscription.current_period_end).toDateString();
  return sendEmail({
    to: user.email,
    subject: `Subscription cancelled — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#dc2626;margin:0 0 8px">Subscription Cancelled</h2>
      <p style="color:#475569">
        Hi ${user.name}, your <strong>${plan.display_name}</strong> subscription
        has been cancelled.
        ${
          subscription.cancel_at_period_end
            ? `You'll continue to have access until <strong>${endDate}</strong>.`
            : "Your access has ended immediately."
        }
      </p>
      ${
        subscription.cancellation_reason
          ? `<p style="color:#475569"><strong>Reason:</strong> ${subscription.cancellation_reason}</p>`
          : ""
      }
      <p style="color:#94a3b8;font-size:13px">
        We're sorry to see you go. You can resubscribe anytime.
      </p>
      ${btn("Resubscribe", `${FRONTEND}/pricing`)}
    `),
  });
}

export async function sendSubscriptionExpiredEmail(user, plan) {
  return sendEmail({
    to: user.email,
    subject: `Subscription expired — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#dc2626;margin:0 0 8px">Subscription Expired</h2>
      <p style="color:#475569">
        Hi ${user.name}, your <strong>${plan.display_name}</strong>
        subscription has expired.
        Renew now to keep your benefits.
      </p>
      ${btn("Renew Now", `${FRONTEND}/pricing`, "#16a34a")}
    `),
  });
}

export async function sendSubscriptionPaymentFailedEmail(user, plan, invoice) {
  return sendEmail({
    to: user.email,
    subject: `Payment failed — ${APP_NAME} subscription`,
    html: wrap(`
      <h2 style="color:#dc2626;margin:0 0 8px">Payment Failed ⚠️</h2>
      <p style="color:#475569">
        Hi ${user.name}, we couldn't process your payment for
        <strong>${plan.display_name}</strong>.
      </p>
      ${table(
        row(
          "Amount",
          `${invoice.currency} ${Number(invoice.amount).toLocaleString()}`,
          false,
        ),
        row("Reason", invoice.failure_reason || "Card declined", true),
      )}
      <p style="color:#475569;font-size:14px">
        Please update your payment method to avoid losing access.
      </p>
      ${btn("Update Payment", `${FRONTEND}/settings/subscription`, "#dc2626")}
    `),
  });
}

export async function sendTrialEndingEmail(user, plan, daysLeft) {
  return sendEmail({
    to: user.email,
    subject: `Your free trial ends in ${daysLeft} day${daysLeft !== 1 ? "s" : ""} — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Trial Ending Soon ⏰</h2>
      <p style="color:#475569">
        Hi ${user.name}, your free trial of <strong>${plan.display_name}</strong>
        ends in <strong>${daysLeft} day${daysLeft !== 1 ? "s" : ""}</strong>.
      </p>
      <p style="color:#475569">
        Subscribe now to keep your benefits and avoid interruption.
      </p>
      ${btn("Subscribe Now", `${FRONTEND}/pricing`)}
    `),
  });
}

export async function sendProBadgeActivatedEmail(maid) {
  return sendEmail({
    to: maid.email,
    subject: `Verified Pro badge activated — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">You're a Verified Pro! 🏅</h2>
      <p style="color:#475569">
        Hi ${maid.name}, your Verified Pro badge is now active on your profile.
        Customers can see you're verified and trustworthy.
      </p>
      <ul style="color:#475569;font-size:14px;line-height:1.8">
        <li>✅ Verified Pro badge on your profile</li>
        <li>✅ Priority listing in customer searches</li>
        <li>✅ 20% more visibility on the platform</li>
        <li>✅ Trust badge on all your bookings</li>
      </ul>
      ${btn("View Your Profile", `${FRONTEND}/maid/profile`)}
    `),
  });
}
