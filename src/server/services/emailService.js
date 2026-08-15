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
import { isOptedOut, unsubscribeUrl } from './emailPreferences.js';

/**
 * Templates that are SECURITY / ACCOUNT-RECOVERY mail and are therefore never
 * suppressed by the unsubscribe list.
 *
 * Someone who unsubscribes from onboarding mail has not asked to be locked out of
 * their own account. A password reset that silently does not arrive is an
 * account-recovery failure that presents to the user as a broken product, and to
 * support as an unreproducible ticket.
 */
const ESSENTIAL_TEMPLATES = new Set(['password_reset', 'email_verification']);

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

const SITE = 'https://xenostudio.ai';

/**
 * One checklist row.
 *
 * Built from a <table>, not flexbox or grid, because Outlook renders email through
 * Word's HTML engine, which supports neither. Table-based layout is not legacy
 * styling here — it is the only layout primitive that works everywhere.
 */
function checklistRow(title, subtitle, href) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 10px 0; border: 1px solid rgba(255,255,255,0.10); border-radius: 6px;">
      <tr>
        <td style="padding: 14px 16px;">
          <a href="${escapeHtml(href)}" style="color: rgba(255,255,255,0.90); font-size: 14px; font-weight: 600; text-decoration: none;">${escapeHtml(title)}</a>
          <div style="color: rgba(255,255,255,0.45); font-size: 13px; line-height: 1.5; margin-top: 4px;">${escapeHtml(subtitle)}</div>
        </td>
      </tr>
    </table>`;
}

/**
 * The quoted answer, with its author identified by KIND.
 *
 * The excerpt is capped here rather than at the call site because a post body
 * can be 60 000 characters and no call site should have to remember that. A
 * mail that carries a whole essay is a mail nobody reads and some clients clip
 * outright (Gmail truncates around 102 KB and hides the rest behind "View
 * entire message" — losing the unsubscribe link at the bottom, which is a
 * compliance problem, not a cosmetic one).
 *
 * Bodies are user-authored markdown. They are escaped, never rendered: the
 * Forum's own web view is safe because it uses ReactMarkdown without
 * rehype-raw, and interpolating the same text into an email as HTML would
 * reintroduce exactly the injection the web view avoids — in a surface with no
 * CSP, delivered to someone's inbox.
 */
function answerBlock(authorName, authorKind, authorOwner, excerpt) {
  const isAgent = authorKind === 'agent';
  const body = String(excerpt || '').trim();
  const clipped = body.length > 420 ? `${body.slice(0, 420).trimEnd()}…` : body;

  // An agent with no visible owner must not render as a bare name — the owner
  // is who is accountable (§4.4). Falling back to "operated by an unnamed
  // owner" is deliberately awkward: it should look wrong, because it is.
  const attribution = isAgent
    ? `<span style="display: inline-block; border: 1px solid rgba(255,255,255,0.20); border-radius: 3px; padding: 1px 5px; font-size: 10px; font-weight: 600; letter-spacing: 0.08em; color: rgba(255,255,255,0.65); margin-left: 6px;">AGENT</span>
       <div style="color: rgba(255,255,255,0.35); font-size: 12px; margin-top: 3px;">operated by ${escapeHtml(authorOwner || 'an unnamed owner')}</div>`
    : '';

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 20px 0; border: 1px solid rgba(255,255,255,0.10); border-radius: 6px; background-color: #060608;">
      <tr>
        <td style="padding: 16px 18px;">
          <div style="color: rgba(255,255,255,0.90); font-size: 13px; font-weight: 600;">
            ${escapeHtml(authorName || 'Someone')}${attribution}
          </div>
          <div style="color: rgba(255,255,255,0.55); font-size: 14px; line-height: 1.6; margin-top: 10px; white-space: pre-wrap;">${escapeHtml(clipped)}</div>
        </td>
      </tr>
    </table>`;
}

/**
 * Forum footer.
 *
 * The unsubscribe is category-scoped (`category=forum`) so switching off forum
 * mail does not switch off password resets. `emailPreferences.isOptedOut()`
 * already takes a category; this is the reader-facing half of that.
 */
function forumFooter(unsubUrl) {
  return `
      <hr class="divider">
      <p class="muted">You are getting this because you took part in this thread.
        ${unsubUrl ? `<a href="${escapeHtml(unsubUrl)}" style="color: rgba(255,255,255,0.45);">Turn off Forum email</a>. Security email like password resets will still reach you.` : ''}</p>
      <p class="muted"><a href="${SITE}/forum" style="color: rgba(255,255,255,0.35);">XENO Forum</a> &middot; <a href="${SITE}/privacy" style="color: rgba(255,255,255,0.35);">Privacy</a></p>`;
}

// --------------------------------------------------------------------------
// Templates
// --------------------------------------------------------------------------
const templates = {
  /**
   * The onboarding email. Structure follows the pattern every good product welcome
   * uses (a short promise, then a CHECKLIST of concrete first actions, then help
   * resources) because "welcome, your account is created" gives the reader nothing
   * to do, and a welcome email's only job is the first action.
   *
   * Every claim here must be something XENO actually ships today. Do not add a
   * checklist row for a product that is not downloadable — an onboarding email that
   * sends people to a dead end is worse than no onboarding email.
   */
  welcome: ({ displayName, loginUrl, unsubscribeUrl: unsubUrl }) => ({
    subject: 'Welcome to XENO. Let\'s get you set up.',
    html: wrapInLayout('Welcome to XENO', `
      <h1>Welcome${displayName ? `, ${escapeHtml(displayName)}` : ''}</h1>
      <p>XENO is the harness for agentic work: bring your own AI, drive it across creative,
         technical and research tasks, in one workspace.</p>
      <p style="color: rgba(255,255,255,0.90); font-size: 15px; font-weight: 600; margin-top: 28px;">Your set-up checklist</p>

      ${checklistRow('Download XENO Hub', 'One launcher for every XENO app, with updates built in.', `${SITE}/product/hub/download`)}
      ${checklistRow('Bring your own AI', 'Connect your own provider key and pay no markup — or run open models locally.', `${SITE}/docs`)}
      ${checklistRow('Open a creative app', 'Canvas for design, Motion for video, Browser for the agent-native web.', `${SITE}/products`)}
      ${checklistRow('Read the docs', 'Guides for every app, the API, and the agent tooling.', `${SITE}/docs`)}

      <hr class="divider">
      <p style="text-align: center;">
        <a href="${escapeHtml(loginUrl || SITE)}" class="btn">Open XENO</a>
      </p>
      <hr class="divider">
      <p class="muted">Didn't create this account? You can ignore this email — nothing else will happen.</p>
      ${unsubUrl ? `<p class="muted">Don't want product emails? <a href="${escapeHtml(unsubUrl)}" style="color: rgba(255,255,255,0.45);">Unsubscribe</a>. We'll still send security emails like password resets.</p>` : ''}
      <p class="muted"><a href="${SITE}/impressum" style="color: rgba(255,255,255,0.35);">Impressum</a> &middot; <a href="${SITE}/privacy" style="color: rgba(255,255,255,0.35);">Privacy</a></p>
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

  email_verification: ({ displayName, verifyUrl, expiresIn }) => ({
    subject: 'Verify your XENO email',
    html: wrapInLayout('Verify your email', `
      <h1>Verify your email</h1>
      <p>Hi ${escapeHtml(displayName)},</p>
      <p>Confirm this email address to secure your XENO account and enable password recovery.</p>
      <p style="text-align: center;">
        <a href="${verifyUrl}" class="btn">Verify Email</a>
      </p>
      <hr class="divider">
      <p class="muted">This link expires in ${expiresIn || '24 hours'}. If you didn't create a XENO account, you can safely ignore this email.</p>
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

  // ------------------------------------------------------------------------
  // Forum notifications (WP1)
  //
  // A forum where nobody learns they were answered has no loop, and every
  // other piece of the Forum depends on that loop closing. These are the
  // emails that close it.
  //
  // Three rules shape all of them:
  //
  //   1. CARRY THE ANSWER, don't advertise it. "You have a new reply — click
  //      to view" spends the reader's attention to tell them attention is
  //      required. The answer is usually short enough to read right here, and
  //      a reader who got what they needed without a round trip is exactly the
  //      outcome — time-to-resolution, not time-on-site (§5.4). The click is
  //      for accepting, replying, or reading the rest.
  //
  //   2. SAY WHETHER A MACHINE WROTE IT. XENO Forum is one corpus for humans
  //      and agents (§4), so "answered by @pixel-dev, an agent operated by
  //      Maria" is information the reader is owed before they trust the
  //      answer. No other forum's notification has to do this. The owner is
  //      shown because the owner is who is accountable (§4.4).
  //
  //   3. NEVER A SCORE. No reputation integer, no "you earned 15 points", no
  //      streak (D4). The reward for being answered is the answer.
  // ------------------------------------------------------------------------

  /**
   * The whole loop in one email: your question got an answer.
   *
   * `authorKind` is 'human' | 'agent'. `authorOwner` is only meaningful for an
   * agent and is REQUIRED when authorKind is 'agent' — an agent with no visible
   * owner is exactly the accountability gap §4.4 exists to close.
   */
  forum_answer: ({ displayName, threadTitle, threadUrl, authorName, authorKind, authorOwner, excerpt, unsubscribeUrl: unsubUrl }) => ({
    // The question in the subject, because that is what the reader recognises.
    // "New reply on the XENO Forum" is a subject about us; this one is about them.
    subject: `Answered: ${threadTitle}`,
    html: wrapInLayout('You have an answer', `
      <h1>Your question was answered</h1>
      <p>Hi ${escapeHtml(displayName)}, someone answered
         <a href="${escapeHtml(threadUrl)}" class="highlight" style="text-decoration: none;">${escapeHtml(threadTitle)}</a>.</p>

      ${answerBlock(authorName, authorKind, authorOwner, excerpt)}

      <p style="text-align: center;">
        <a href="${escapeHtml(threadUrl)}" class="btn">Read the full answer</a>
      </p>
      <p class="muted" style="text-align: center;">If it solved your problem, accept it — that is what makes
         the next person's search find it instead of asking again.</p>
      ${forumFooter(unsubUrl)}
    `),
  }),

  /** Your answer was accepted. The only "reward" the Forum hands out, and it is not a number. */
  forum_accepted: ({ displayName, threadTitle, threadUrl, askerName, unsubscribeUrl: unsubUrl }) => ({
    subject: `Your answer was accepted: ${threadTitle}`,
    html: wrapInLayout('Answer accepted', `
      <h1>Your answer was accepted</h1>
      <p>Hi ${escapeHtml(displayName)}, ${escapeHtml(askerName || 'the person who asked')} accepted your answer on
         <a href="${escapeHtml(threadUrl)}" class="highlight" style="text-decoration: none;">${escapeHtml(threadTitle)}</a>.</p>
      <p>It is now the answer anyone — or any agent — searching this problem will find first.
         That is the entire point of writing it down.</p>
      <p style="text-align: center;">
        <a href="${escapeHtml(threadUrl)}" class="btn">View the thread</a>
      </p>
      ${forumFooter(unsubUrl)}
    `),
  }),

  /** Someone replied to you in a thread you are part of. Lower-stakes than an answer. */
  forum_reply: ({ displayName, threadTitle, threadUrl, authorName, authorKind, authorOwner, excerpt, unsubscribeUrl: unsubUrl }) => ({
    subject: `New reply: ${threadTitle}`,
    html: wrapInLayout('New reply', `
      <h1>New reply</h1>
      <p>Hi ${escapeHtml(displayName)}, there is a new reply on
         <a href="${escapeHtml(threadUrl)}" class="highlight" style="text-decoration: none;">${escapeHtml(threadTitle)}</a>.</p>

      ${answerBlock(authorName, authorKind, authorOwner, excerpt)}

      <p style="text-align: center;">
        <a href="${escapeHtml(threadUrl)}" class="btn">Open the thread</a>
      </p>
      ${forumFooter(unsubUrl)}
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

  // Honour the unsubscribe list — but NEVER for security/recovery mail.
  const essential = ESSENTIAL_TEMPLATES.has(template);
  if (!essential && await isOptedOut(db, toEmail)) {
    console.log(`[Email] suppressed (opted out) — template: ${template}, to: ${toEmail}`);
    return { success: false, suppressed: true, reason: 'opted_out' };
  }

  // Non-essential mail carries a working one-click unsubscribe. It is computed here
  // rather than passed by each caller so a new template cannot ship without one.
  const { subject, html } = templateFn(
    essential ? data : { ...data, unsubscribeUrl: data?.unsubscribeUrl || unsubscribeUrl(toEmail) },
  );
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
    // Production: send via Resend API
    if (process.env.RESEND_API_KEY) {
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM || 'XENO <noreply@xenostudio.ai>',
          to: [toEmail],
          subject,
          html,
        }),
      });

      if (!resendResponse.ok) {
        const errBody = await resendResponse.text();
        throw new Error(`Resend API error ${resendResponse.status}: ${errBody}`);
      }

      const resendData = await resendResponse.json();
      console.log(`[Email] Sent via Resend to ${toEmail}: ${subject} (id: ${resendData.id})`);
    } else if (process.env.SENDGRID_API_KEY) {
      // Fallback: SendGrid
      const sgResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: toEmail }] }],
          from: { email: process.env.SENDGRID_FROM || 'noreply@xenostudio.ai', name: 'XENO' },
          subject,
          content: [{ type: 'text/html', value: html }],
        }),
      });

      if (!sgResponse.ok) {
        const errBody = await sgResponse.text();
        throw new Error(`SendGrid API error ${sgResponse.status}: ${errBody}`);
      }

      console.log(`[Email] Sent via SendGrid to ${toEmail}: ${subject}`);
    } else {
      // No provider configured — the message goes to the console and NOWHERE ELSE.
      //
      // This branch used to fall through to `status = 'sent'`, so `email_logs` recorded
      // a successful delivery for a message that was never transmitted. Production had
      // exactly one row in that table, reading 'sent', for an email nobody received —
      // an operator checking whether email worked would have concluded that it did.
      // A no-op must never report success.
      console.log(`[Email] NOT CONFIGURED — no RESEND_API_KEY/SENDGRID_API_KEY. Template: ${template}, To: ${toEmail}, Subject: ${subject}`);
      if (db) {
        await db.query(
          'UPDATE email_logs SET status = $1, error = $2 WHERE id = $3',
          ['skipped', 'no email provider configured', emailId]
        );
      }
      return { success: false, skipped: true, reason: 'no_provider', emailId };
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
 * Send the onboarding email for a newly created account.
 *
 * FIRE AND FORGET, DELIBERATELY. Signup must never fail because an email provider is
 * slow, misconfigured or down — a person who successfully created an account and then
 * saw a 500 would reasonably conclude they have no account, and try again. The send
 * is awaited by nobody and every failure is swallowed to a log line.
 *
 * Called from all THREE account-creation paths in routes/authRoutes.js: /register,
 * /register-with-handle, and findOrCreateOAuthUser. The OAuth one matters most —
 * 160 of the platform's 221 accounts were created that way, so wiring only the
 * password path would have missed nearly three quarters of new users.
 */
export function sendWelcomeEmail(db, user) {
  if (!user?.email) return;
  const displayName = user.display_name || user.displayName || user.username || '';
  Promise.resolve()
    .then(() => sendEmail(db, 'welcome', user.email, {
      displayName,
      loginUrl: 'https://xenostudio.ai',
    }, user.id || null))
    .catch((err) => console.error(`[Email] welcome send failed for ${user.email}:`, err?.message || err));
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
