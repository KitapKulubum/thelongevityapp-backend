import nodemailer from 'nodemailer';

/**
 * Email service for sending password reset OTP codes.
 * Configure via environment variables:
 * - SMTP_HOST (e.g., smtp.gmail.com)
 * - SMTP_PORT (e.g., 587)
 * - SMTP_USER (email address)
 * - SMTP_PASS (email password or app password)
 * - SMTP_FROM (sender email, defaults to SMTP_USER)
 */
let transporter: nodemailer.Transporter | null = null;

function isSMTPConfigured(): boolean {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  return !!(host && user && pass);
}

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) {
    return transporter;
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    // Return null to indicate SMTP is not configured
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });

  return transporter;
}

/**
 * Sends a password reset OTP code to the user's email.
 * In development mode without SMTP configured, logs the code to console instead.
 */
export async function sendPasswordResetOTP(email: string, code: string): Promise<void> {
  const transporter = getTransporter();

  // If SMTP is not configured, log to console for development
  if (!transporter || !isSMTPConfigured()) {
    console.log('\n========================================');
    console.log('[emailService] SMTP not configured - OTP code (for development):');
    console.log(`Email: ${email}`);
    console.log(`Code: ${code}`);
    console.log('========================================\n');
    return;
  }

  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@thelongevityapp.com';

  const mailOptions = {
    from: `Longevity AI <${fromEmail}>`,
    to: email,
    subject: 'Your verification code',
    text: `Your Longevity AI verification code is: ${code}\n\nThis code expires in 10 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Password Reset Verification</h2>
        <p>Your Longevity AI verification code is:</p>
        <div style="background-color: #f5f5f5; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 4px; margin: 20px 0;">
          ${code}
        </div>
        <p style="color: #666;">This code expires in 10 minutes.</p>
        <p style="color: #666; font-size: 12px; margin-top: 30px;">If you didn't request this code, please ignore this email.</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[emailService] Password reset OTP sent to ${email}`);
  } catch (error: any) {
    console.error('[emailService] Failed to send email:', error);
    throw new Error('Failed to send verification email');
  }
}

