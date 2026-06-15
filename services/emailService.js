// services/emailService.js
import nodemailer from "nodemailer";

// Configure email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendApplicationConfirmation = async (application) => {
  const emailContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #c9a84c; padding: 20px; text-align: center; color: #0a0a0f; }
        .content { padding: 30px; background: #f9f9f9; }
        .button { background: #c9a84c; color: #0a0a0f; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; }
        .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Deusizi Academy</h1>
        </div>
        <div class="content">
          <h2>Thank you for applying, ${application.full_name}!</h2>
          <p>Your application to Deusizi Academy has been received.</p>
          <p><strong>Reference Number:</strong> ${application.reference_number}</p>
          <p><strong>Selected Track:</strong> ${application.preferred_track}</p>
          <p>Our admissions team will review your application and contact you within 48 hours.</p>
          <p>If you have any questions, please reply to this email.</p>
          <a href="${process.env.FRONTEND_URL}/application-status?ref=${application.reference_number}" class="button">Check Status</a>
        </div>
        <div class="footer">
          <p>Deusizi Academy — Professional training for cleaners</p>
          <p>© ${new Date().getFullYear()} Deusizi. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    await transporter.sendMail({
      from: `"Deusizi Academy" <${process.env.SMTP_FROM}>`,
      to: application.email,
      subject: `Application Received - ${application.reference_number}`,
      html: emailContent,
    });
    console.log(`Confirmation email sent to ${application.email}`);
  } catch (error) {
    console.error("Error sending confirmation email:", error);
    throw error;
  }
};

export const sendAdminNotification = async (application) => {
  const emailContent = `
    <h2>New Cleaner Training Application</h2>
    <p><strong>Name:</strong> ${application.full_name}</p>
    <p><strong>Email:</strong> ${application.email}</p>
    <p><strong>Phone:</strong> ${application.phone}</p>
    <p><strong>City:</strong> ${application.city}</p>
    <p><strong>Track:</strong> ${application.preferred_track}</p>
    <p><strong>Experience:</strong> ${application.experience_level || "Not specified"}</p>
    <p><strong>Availability:</strong> ${application.availability?.join(", ")}</p>
    <p><strong>Motivation:</strong> ${application.motivation}</p>
    <a href="${process.env.ADMIN_URL}/cleaner-applications/${application.id}">View Application</a>
  `;

  try {
    await transporter.sendMail({
      from: `"Deusizi Academy" <${process.env.SMTP_FROM}>`,
      to: process.env.ADMIN_EMAIL,
      subject: `New Application: ${application.full_name}`,
      html: emailContent,
    });
    console.log(`Admin notification sent`);
  } catch (error) {
    console.error("Error sending admin notification:", error);
    // Don't throw - admin notification failure shouldn't block the response
  }
};
