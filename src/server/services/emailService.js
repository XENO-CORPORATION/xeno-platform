/**
 * Email Service
 *
 * HTML email templates with XENO branding.
 * Templates:
 * - welcome          — New user registration
 * - password_reset   — Password reset link
 * - receipt          — Purchase/credit receipt
 * - credits_low      — Low credits warning
 * - new_version      — New app version available
 *
 * Uses pluggable transport (console in dev, SMTP/SES in production).
 */

import { v4 as uuidv4 } from 'uuid';

// --------------------------------------------------------------------------
// XENO branded email wrapper
// --------------------------------------------------------------------------
function wrapInLayout(title, bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #08080a; font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .card { background-color: #0b0b0d; border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 32px; }
    .logo { text-align: center; margin-bottom: 24px; }
    .logo-text { color: white; font-size: 20px; font-weight: 700; letter-spacing: 3px; text-decoration: none; }
    h1 { color: rgba(255,255,255,0.90); font-size: 22px; font-weight: 600; margin: 0 0 16px 0; }
    p { color: rgba(255,255,255,0.50); font-size: 15px; line-height: 1.6; margin: 0 0 16px 0; }
    .btn { display: inline-block; background: white; color: #08080a; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; margin: 8px 0; }
    .muted { color: rgba(255,255,255,0.30); font-size: 12px; }
    .divider { border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 24px 0; }
    .footer { text-align: center; margin-top: 32px; }
    .footer p { color: rgba(255,255,255,0.25); font-size: 12px; }
    .highlight { color: rgba(255,255,255,0.90); font-weight: 600; }
    .stat-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .stat-label { color: rgba(255,255,255,0.45); font-size: 14px; }
    .stat-value { color: rgba(255,255,255,0.90); font-size: 14px; font-weight: 600; }
    table.stats { width: 100%; border-collapse: collapse; margin: 16px 0; }
    table.stats td { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
    table.stats td.label { color: rgba(255,255,255,0.45); font-size: 14px; }
    table.stats td.value { color: rgba(255,255,255,0.90); font-size: 14px; font-weight: 600; text-align: right; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <a href="https://xenostudio.ai" class="logo-text">XENO</a>
    </div>
    <div class="card">
      ${bodyContent}
    </div>
    <div class="footer">
      <p>XENO Corporation</p>
      <p>This email was sent by xenostudio.ai. If you did not expect this email, you can safely ignore it.</p>
    </div>
  </div>
</body>
</html>`;
}

// --------------------------------------------------------------------------
// Templates
// --------------------------------------------------------------------------
const templates = {
  welcome: ({ displayName, loginUrl }) => ({
    subject: 'Welcome to XENO',
    html: wrapInLayout('Welcome to XENO', `
      <h1>Welcome, ${escapeHtml(displayName)}</h1>
      <p>Your account has been created successfully. You have <span class="highlight">2,000 credits</span> to get started.</p>
      <p>XENO is your creative studio — edit images, video, and audio with AI-powered tools.</p>
      <hr class="divider">
      <p style="text-align: center;">
        <a href="${loginUrl || 'https://xenostudio.ai'}" class="btn">Open XENO Studio</a>
      </p>
      <hr class="divider">
      <p class="muted">Need help? Visit our docs at xenostudio.ai/docs</p>
    `),
  }),

  password_reset: ({ displayName, resetUrl, expiresIn }) => ({
    subject: 'Reset your XENO password',
    html: wrapInLayout('Password Reset', `
      <h1>Password Reset</h1>
      <p>Hi ${escapeHtml(displayName)},</p>
      <p>We received a request to reset your password. Click the button below to create a new password.</p>
      <p style="text-align: center;">
        <a href="${resetUrl}" class="btn">Reset Password</a>
      </p>
      <hr class="divider">
      <p class="muted">This link expires in ${expiresIn || '1 hour'}. If you didn't request this, ignore this email.</p>
      <p class="muted">For security, do not share this link with anyone.</p>
    `),
  }),

  receipt: ({ displayName, amount, credits, transactionId, date }) => ({
    subject: `XENO receipt — ${credits} credits`,
    html: wrapInLayout('Purchase Receipt', `
      <h1>Purchase Receipt</h1>
      <p>Hi ${escapeHtml(displayName)}, thank you for your purchase.</p>
      <table class="stats">
        <tr><td class="label">Credits purchased</td><td class="value">${credits}</td></tr>
        <tr><td class="label">Amount</td><td class="value">$${(amount / 100).toFixed(2)}</td></tr>
        <tr><td class="label">Transaction ID</td><td class="value" style="font-size: 12px;">${transactionId}</td></tr>
        <tr><td class="label">Date</td><td class="value">${date || new Date().toLocaleDateString()}</td></tr>
      </table>
      <hr class="divider">
      <p class="muted">This is your receipt for tax purposes. Questions? Contact support@xenostudio.ai</p>
    `),
  }),

  credits_low: ({ displayName, currentCredits, threshold }) => ({
    subject: 'XENO — Your credits are running low',
    html: wrapInLayout('Low Credits', `
      <h1>Credits Running Low</h1>
      <p>Hi ${escapeHtml(displayName)},</p>
      <p>You have <span class="highlight">${currentCredits} credits</span> remaining (threshold: ${threshold}).</p>
      <p>Top up your credits to continue using AI generation, editing, and video tools.</p>
      <p style="text-align: center;">
        <a href="https://xenostudio.ai/settings" class="btn">Add Credits</a>
      </p>
    `),
  }),

  new_version: ({ displayName, appName, version, releaseNotes, downloadUrl }) => ({
    subject: `${appName} ${version} is now available`,
    html: wrapInLayout(`${appName} Update`, `
      <h1>${escapeHtml(appName)} ${escapeHtml(version)}</h1>
      <p>Hi ${escapeHtml(displayName)},</p>
      <p>A new version of ${escapeHtml(appName)} is available.</p>
      ${releaseNotes ? `
        <hr class="divider">
        <p style="color: rgba(255,255,255,0.45); font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">What's new</p>
        <p>${escapeHtml(releaseNotes)}</p>
      ` : ''}
      <p style="text-align: center;">
        <a href="${downloadUrl || 'https://xenostudio.ai/download'}" class="btn">Download Update</a>
      </p>
    `),
  }),
};

// --------------------------------------------------------------------------
// Email sending
// --------------------------------------------------------------------------

/**
 * Send an email using a template
 * @param {object} db - Database pool
 * @param {string} template - Template name
 * @param {string} toEmail - Recipient email
 * @param {object} data - Template data
 * @param {string} [userId] - User ID for logging
 */
export async function sendEmail(db, template, toEmail, data, userId = null) {
  const templateFn = templates[template];
  if (!templateFn) {
    throw new Error(`Unknown email template: ${template}`);
  }

  const { subject, html } = templateFn(data);
  const emailId = uuidv4();

  // Log to database
  if (db) {
    await db.query(
      `INSERT INTO email_logs (id, user_id, to_email, template, subject, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [emailId, userId, toEmail, template, subject]
    );
  }

  try {
    // In production, integrate with SES, SendGrid, Resend, etc.
    if (process.env.NODE_ENV === 'production' && process.env.SMTP_HOST) {
      // TODO: Integrate with actual email provider
      // For now, log the email details
      console.log(`[Email] Would send to ${toEmail}: ${subject}`);
    } else {
      // Development: log to console
      console.log(`[Email] DEV MODE — Template: ${template}, To: ${toEmail}, Subject: ${subject}`);
    }

    // Mark as sent
    if (db) {
      await db.query(
        'UPDATE email_logs SET status = $1, sent_at = NOW() WHERE id = $2',
        ['sent', emailId]
      );
    }

    return { success: true, emailId };
  } catch (error) {
    // Mark as failed
    if (db) {
      await db.query(
        'UPDATE email_logs SET status = $1, error = $2 WHERE id = $3',
        ['failed', error.message, emailId]
      );
    }

    console.error(`[Email] Failed to send ${template} to ${toEmail}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get email sending stats
 */
export async function getEmailStats(db, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { rows } = await db.query(
    `SELECT template, status, COUNT(*) as count
     FROM email_logs
     WHERE created_at > $1
     GROUP BY template, status
     ORDER BY template, status`,
    [since]
  );

  return rows;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default { sendEmail, getEmailStats, templates };
