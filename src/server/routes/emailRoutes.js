/**
 * /api/email/* — public email preference endpoints.
 *
 * PUBLIC BY DESIGN, and that is the whole point: an unsubscribe link is clicked from
 * an inbox, by someone who is very often not signed in and may no longer have an
 * account at all. Requiring a login to stop receiving mail is both hostile and, in
 * the EU, not a valid opt-out mechanism.
 *
 * Authority comes from the HMAC token in the link instead (services/
 * emailPreferences.js), so a link works only for the address it was minted for.
 */
import express from 'express';
import { optOut, verifyUnsubscribeToken, normalizeEmail } from '../services/emailPreferences.js';

const router = express.Router();

/** A plain, self-contained confirmation page. A person clicked this, not a client. */
function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  body { margin:0; background:#08080a; color:rgba(255,255,255,.9);
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
         display:flex; align-items:center; justify-content:center; min-height:100vh; }
  .card { max-width:460px; padding:32px; border:1px solid rgba(255,255,255,.08);
          border-radius:8px; background:#0b0b0d; }
  h1 { font-size:20px; margin:0 0 12px; }
  p { color:rgba(255,255,255,.55); font-size:14px; line-height:1.6; margin:0 0 12px; }
  a { color:rgba(255,255,255,.85); }
</style></head>
<body><div class="card">${body}</div></body></html>`;
}

/**
 * GET|POST /api/email/unsubscribe?email=…&token=…
 *
 * POST is accepted for RFC 8058 one-click unsubscribe, which Gmail and Yahoo now
 * expect from bulk senders. Both verbs do the same thing; GET renders a page because
 * a human followed the link, POST answers 200 for the mail client.
 */
async function handleUnsubscribe(req, res) {
  const email = normalizeEmail(req.query.email || req.body?.email);
  const token = req.query.token || req.body?.token;

  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    // Do NOT distinguish "unknown address" from "bad signature" — that difference is
    // an address-enumeration oracle.
    if (req.method === 'POST') return res.status(400).json({ error: 'invalid_unsubscribe_link' });
    return res.status(400).send(page('Invalid link', `
      <h1>That link isn't valid</h1>
      <p>The unsubscribe link looks incomplete or was altered in transit. Try copying
         the whole link from the email, or reply to the message and we'll remove you
         by hand.</p>`));
  }

  try {
    await optOut(req.db, email, { reason: 'user_unsubscribe_link' });
  } catch (err) {
    console.error('[email] unsubscribe failed:', err?.message || err);
    if (req.method === 'POST') return res.status(500).json({ error: 'unsubscribe_failed' });
    return res.status(500).send(page('Something went wrong', `
      <h1>We couldn't complete that</h1>
      <p>Please try again shortly. If it keeps failing, reply to the email and we'll
         remove you manually.</p>`));
  }

  if (req.method === 'POST') return res.json({ success: true, unsubscribed: true });
  return res.send(page('Unsubscribed', `
    <h1>You're unsubscribed</h1>
    <p>We've removed <strong>${email.replace(/[<>&"]/g, '')}</strong> from XENO product emails.</p>
    <p>You'll still receive security emails — password resets and email verification —
       because those protect access to your account.</p>
    <p><a href="https://xenostudio.ai">Back to xenostudio.ai</a></p>`));
}

router.get('/unsubscribe', handleUnsubscribe);
router.post('/unsubscribe', handleUnsubscribe);

export default router;
