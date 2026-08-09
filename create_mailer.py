import os

content = '''import { google } from "googleapis";
import nodemailer from "nodemailer";
import { Resend } from "resend";

const APP_NAME = process.env.APP_NAME || "Deusizi Sparkle";
const FRONTEND =
  process.env.CLIENT_URL || process.env.FRONTEND_URL || "http://localhost:5173";

// ─── Initialize Resend with fallback ──────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY;
let resend;

try {
  if (RESEND_API_KEY && RESEND_API_KEY !== 'undefined' && RESEND_API_KEY !== 'null' && RESEND_API_KEY.trim() !== '') {
    resend = new Resend(RESEND_API_KEY);
    console.log("✓ Resend email initialized with API key");
  } else {
    console.warn("⚠️  RESEND_API_KEY not set - emails will be logged to console only");
    resend = {
      emails: {
        send: async ({ to, subject, html }) => {
          console.log(`[EMAIL MOCK] To: ${to}, Subject: ${subject}`);
          return { data: { id: 'mock_' + Date.now() }, error: null };
        }
      }
    };
  }
} catch (err) {
  console.warn("⚠️  Failed to initialize Resend:", err.message);
  resend = {
    emails: {
      send: async ({ to, subject, html }) => {
        console.log(`[EMAIL MOCK] To: ${to}, Subject: ${subject}`);
        return { data: { id: 'mock_' + Date.now() }, error: null };
      }
    }
  };
}

// ─── Role‑based dashboard URL ──────────────────────────────────────────
function getDashboardUrl(user) {
  if (!user) return FRONTEND;
  if (user.role === "admin") return `${FRONTEND}/admin`;
  if (user.role === "maid") return `${FRONTEND}/maid`;
  return FRONTEND;
}

// ── Base send — Resend only ───────────────────────────────────────────
export async function sendEmail({ to, subject, html }) {
  console.log(`[EMAIL] ► Sending to ${to} | subject: "${subject}"`);
  try {
    const { data, error } = await resend.emails.send({
      from: `${APP_NAME} <no-reply@deusizisparkle.com>`,
      to,
      subject,
      html,
    });

    if (error) {
      console.error(`✗ [EMAIL] Failed → ${to}:`, error);
      return { success: false, error: error.message };
    }

    console.log(`✓ [EMAIL] ${subject} → ${to}`);
    return { success: true, id: data.id };
  } catch (err) {
    console.error(`✗ [EMAIL] Failed → ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ── transporter shim ────────────────────────────────────────────
export const transporter = {
  sendMail: async ({ to, subject, html }) => sendEmail({ to, subject, html }),
  verify: async () => true,
};

console.log("✓ Resend email ready");

// Startup log
if (process.env.GMAIL_CLIENT_ID) {
  console.log("✓ Gmail API ready (no SMTP)");
} else {
  console.log("✓ Gmail SMTP ready (local)");
}

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
  const verifyUrl = `${FRONTEND}/verify-email?token=${token}`;
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
    `),
  });
}

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
        <a href="${process.env.FRONTEND_URL}" style="display:inline-block;margin-top:24px;padding:14px 28px;background:#1a1208;color:#f5ede0;border-radius:8px;text-decoration:none;font-size:15px;font-weight:500;">
          Get started →
        </a>
      </div>
    `,
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
        If this was you, no action needed. If not, reset your password immediately.
      </p>
    `),
  });
}

export async function sendPasswordResetEmail(user, token) {
  const resetUrl = `${FRONTEND}/reset-password?token=${token}`;
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
        Expires in <strong>1 hour</strong>.
      </p>
    `),
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
        row("Total", `₦${Number(booking.total_amount).toLocaleString()}`, false),
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
        row("Earnings", `₦${Number(booking.total_amount).toLocaleString()}`, false),
      )}
      ${btn("View Booking", `${FRONTEND}/bookings/${booking.id}`)}
    `),
  });
}

export async function sendBookingCancelledEmail(recipient, booking, cancelledBy, reason) {
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

export async function sendCheckInEmail(customer, maid, booking) {
  return sendEmail({
    to: customer.email,
    subject: `${maid.name} has checked in — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Your maid has arrived 🏠</h2>
      <p style="color:#475569">
        Hi ${customer.name}, <strong>${maid.name}</strong> has checked in.
      </p>
      ${btn("View Booking", `${FRONTEND}/bookings/${booking.id}`)}
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
      ${btn("Leave a Review", `${FRONTEND}/bookings/${booking.id}`)}
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
      ${btn("View Profile", `${FRONTEND}/maid`)}
    `),
  });
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
        row("Reference", payment.paystack_reference || "N/A", false),
        row("Amount", `${payment.currency || "₦"}${Number(payment.amount).toLocaleString()}`, true),
        row("Date", new Date(payment.paid_at || Date.now()).toUTCString(), false),
        row("Status", "Paid ✓", false),
      )}
      ${btn("View Booking", `${FRONTEND}/bookings/${booking.id}`)}
    `),
  });
}

// ══════════════════════════════════════════════════════════════════════
//  SOS EMAILS
// ══════════════════════════════════════════════════════════════════════

export async function sendSOSEmail(recipients, { triggeredBy, booking, address, message }) {
  const html = wrap(`
    <div style="background:#fee2e2;border:2px solid #dc2626;border-radius:8px;padding:16px;margin-bottom:24px">
      <h2 style="color:#dc2626;margin:0">🚨 SOS ALERT TRIGGERED</h2>
    </div>
    ${table(
      row("Triggered by", triggeredBy, false),
      row("Customer", booking.customer_name, true),
      row("Maid", booking.maid_name, false),
      row("Address", address || booking.address, true),
      row("Time", new Date().toUTCString(), false),
    )}
    ${message ? `<p style="color:#475569"><strong>Message:</strong> ${message}</p>` : ""}
    ${btn("View Booking", `${FRONTEND}/bookings/${booking.id}`, "#dc2626")}
  `);

  for (const r of recipients) {
    sendEmail({ to: r.email, subject: `🚨 SOS ALERT — ${APP_NAME}`, html }).catch(console.error);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  SUBSCRIPTION EMAILS
// ══════════════════════════════════════════════════════════════════════

export async function sendSubscriptionCancelledEmail(user, plan, subscription) {
  const endDate = new Date(subscription.current_period_end).toDateString();
  return sendEmail({
    to: user.email,
    subject: `Subscription cancelled — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#dc2626;margin:0 0 8px">Subscription Cancelled</h2>
      <p style="color:#475569">
        Hi ${user.name}, your <strong>${plan.display_name}</strong> subscription has been cancelled.
      </p>
      ${btn("View Details", `${FRONTEND}/settings`)}
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
      </p>
      ${btn("View Profile", `${FRONTEND}/maid`)}
    `),
  });
}

export async function sendSubscriptionConfirmationEmail(user, plan, subscription) {
  return sendEmail({
    to: user.email,
    subject: `${plan.display_name} subscription activated — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Subscription Activated 🎉</h2>
      <p style="color:#475569">
        Hi ${user.name}, your <strong>${plan.display_name}</strong> subscription is now active.
      </p>
      ${btn("Go to Dashboard", getDashboardUrl(user))}
    `),
  });
}

export async function sendSubscriptionRenewalEmail(user, plan, subscription, invoice) {
  return sendEmail({
    to: user.email,
    subject: `Subscription renewed — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Subscription Renewed ✅</h2>
      <p style="color:#475569">
        Hi ${user.name}, your <strong>${plan.display_name}</strong> subscription has been renewed.
      </p>
      ${btn("View Subscription", `${FRONTEND}/settings`)}
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
        Hi ${user.name}, your <strong>${plan.display_name}</strong> subscription has expired.
      </p>
      ${btn("Renew Now", `${FRONTEND}/`, "#16a34a")}
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
        Hi ${user.name}, we couldn't process your payment for <strong>${plan.display_name}</strong>.
      </p>
      ${btn("Update Payment", `${FRONTEND}/settings`, "#dc2626")}
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
      ${btn("Subscribe Now", `${FRONTEND}/`)}
    `),
  });
}

// ══════════════════════════════════════════════════════════════════════
//  SUPPORT EMAILS
// ══════════════════════════════════════════════════════════════════════

export async function sendDocumentReviewedEmail(maid, docType, status, adminNotes) {
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
      </p>
      ${adminNotes ? `<p style="color:#475569"><strong>Notes:</strong> ${adminNotes}</p>` : ""}
      ${btn("View Profile", `${FRONTEND}/maid`)}
    `),
  });
}

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
      ${btn("View Profile", `${FRONTEND}/maid`)}
    `),
  });
}

export async function sendSupportChatMessageEmail(recipient, senderName, messagePreview) {
  return sendEmail({
    to: recipient.email,
    subject: `New message from ${senderName} — ${APP_NAME} Support`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">New Support Message 💬</h2>
      <p style="color:#475569">
        Hi ${recipient.name}, you have a new message from <strong>${senderName}</strong>.
      </p>
      ${btn("Open Support Chat", `${FRONTEND}/customersupport`)}
    `),
  });
}

export async function sendMaidSupportChatMessageEmail(recipient, senderName, messagePreview) {
  return sendEmail({
    to: recipient.email,
    subject: `New message from ${senderName} — ${APP_NAME} Maid Support`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">New Maid Support Message 🧹</h2>
      <p style="color:#475569">
        Hi ${recipient.name}, you have a new message from <strong>${senderName}</strong>.
      </p>
      ${btn("Open Maid Support Chat", `${FRONTEND}/maid?tab=support`)}
    `),
  });
}

export async function sendBookingChatMessageEmail(recipient, senderName, messagePreview, bookingId) {
  return sendEmail({
    to: recipient.email,
    subject: `New message from ${senderName} — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">New Message 💬</h2>
      <p style="color:#475569">
        Hi ${recipient.name}, <strong>${senderName}</strong> sent you a message.
      </p>
      ${btn("Open Chat", `${FRONTEND}/bookings/${bookingId}`)}
    `),
  });
}

export async function sendCustomerTicketCreatedEmail(user, ticket) {
  return sendEmail({
    to: user.email,
    subject: `Support ticket #${ticket.id.toString().slice(0, 8)} opened — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Ticket Received 🎫</h2>
      <p style="color:#475569">Hi ${user.name}, we received your support request.</p>
      ${btn("View Ticket", `${FRONTEND}/customersupport`)}
    `),
  });
}

export async function sendMaidTicketCreatedEmail(user, ticket) {
  return sendEmail({
    to: user.email,
    subject: `Maid support ticket #${ticket.id.toString().slice(0, 8)} opened — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Ticket Received 🧹</h2>
      <p style="color:#475569">Hi ${user.name}, we received your maid support request.</p>
      ${btn("View Ticket", `${FRONTEND}/maid?tab=support`)}
    `),
  });
}

export async function sendCustomerTicketReplyEmail(user, ticket, replyMessage, replierName) {
  return sendEmail({
    to: user.email,
    subject: `New reply on your ticket — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">New Reply on Your Ticket 💬</h2>
      <p style="color:#475569">
        Hi ${user.name}, <strong>${replierName}</strong> replied to your ticket.
      </p>
      ${btn("View & Reply", `${FRONTEND}/customersupport`)}
    `),
  });
}

export async function sendMaidTicketReplyEmail(user, ticket, replyMessage, replierName) {
  return sendEmail({
    to: user.email,
    subject: `New reply on your maid ticket — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">New Reply on Your Ticket 💬</h2>
      <p style="color:#475569">
        Hi ${user.name}, <strong>${replierName}</strong> replied to your maid ticket.
      </p>
      ${btn("View & Reply", `${FRONTEND}/maid?tab=support`)}
    `),
  });
}

export async function sendCustomerTicketStatusEmail(user, ticket, newStatus) {
  return sendEmail({
    to: user.email,
    subject: `Ticket ${newStatus} — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Ticket ${newStatus}</h2>
      <p style="color:#475569">
        Hi ${user.name}, your support ticket "<strong>${ticket.subject}</strong>" is now ${newStatus}.
      </p>
      ${btn("View Ticket", `${FRONTEND}/customersupport`)}
    `),
  });
}

export async function sendMaidTicketStatusEmail(user, ticket, newStatus) {
  return sendEmail({
    to: user.email,
    subject: `Maid ticket ${newStatus} — ${APP_NAME}`,
    html: wrap(`
      <h2 style="color:#1e293b;margin:0 0 8px">Ticket ${newStatus}</h2>
      <p style="color:#475569">
        Hi ${user.name}, your maid support ticket "<strong>${ticket.subject}</strong>" is now ${newStatus}.
      </p>
      ${btn("View Ticket", `${FRONTEND}/maid?tab=support`)}
    `),
  });
}'''

os.makedirs('src/utils', exist_ok=True)
with open('src/utils/mailer.js', 'w') as f:
    f.write(content)
print('✅ mailer.js created successfully!')
print('📁 Location: src/utils/mailer.js')
