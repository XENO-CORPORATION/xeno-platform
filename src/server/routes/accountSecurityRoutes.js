/**
 * Account security and data — mounted inside /api/account (routes/accountRoutes.js).
 *
 *   GET    /security                 what this session may do, and how it can confirm
 *   POST   /confirm                  confirm it's you: { password } or { code }
 *   POST   /confirm/code             send a code to the account's address (accounts with no password)
 *   POST   /email                    ask to change the sign-in address        [confirmed]
 *   POST   /email/confirm            { code } from the new address: makes the change
 *   DELETE /email                    drop a pending change
 *   DELETE /sessions                 sign out everywhere else (?all=1 includes this session)
 *   (API keys are managed on the XENO API portal, api.xenosystem.ai: list, create and revoke. Nothing here.)
 *   GET    /exports                  copies of your data
 *   POST   /exports                  ask for a new copy                        [confirmed]
 *   GET    /exports/:id/download     the file
 *   DELETE /exports/:id              remove a copy now
 *   GET    /deletion                 is this account being deleted, and when
 *   POST   /deletion                 delete it after 30 days                   [confirmed]
 *   DELETE /deletion                 keep it
 *   GET    /two-step                 authenticator, passkeys and recovery codes on this account
 *   POST   /two-step/totp            start setting up an authenticator app       [confirmed]
 *   POST   /two-step/totp/confirm    finish it with a code from the app          [confirmed]
 *   DELETE /two-step/totp            turn it off                                 [second step]
 *   POST   /two-step/recovery-codes  replace the recovery codes                  [second step]
 *   POST   /two-step/passkeys/options, /two-step/passkeys   add a passkey        [confirmed]
 *   PATCH  /two-step/passkeys/:id    rename it
 *   DELETE /two-step/passkeys/:id    remove it                                   [second step]
 *   GET    /apps                     the apps signed in with this account
 *   DELETE /apps/:clientId           take an app's access away, now
 *
 * [confirmed] routes answer 403 `confirmation_required` until POST /confirm succeeds in this
 * browser session. An API key has no session, so it can never reach them.
 */
import express from 'express';
import fs from 'fs';
import authMiddleware from '../middleware/auth.js';
import { mailDomain } from '../config/hosts.js';
import { sendEmail } from '../services/emailService.js';
import { EVENTS, recordSecurityEvent, recordSecurityEventTransactional } from '../services/securityEvents.js';
import { hasUsablePassword, revokeOidcAndResetsTransactional, verifyPassword } from './authRoutes.js';
import {
  CODE_MINUTES, clearConfirmation, confirmMethods, confirmWithCode, confirmWithPassword, confirmWithSecondStep, confirmationStatus, issueCode, requireConfirmation,
} from '../services/accountConfirmation.js';
import { cancelEmailChange, completeEmailChange, pendingEmailChange, requestEmailChange } from '../services/accountEmailChange.js';
import { deleteExport, exportFile, listExports, requestExport } from '../services/accountExport.js';
import * as deletion from '../services/accountDeletion.js';
import { listApps, removeApp } from '../services/authorizedApps.js';
import * as twoStep from '../services/twoStep.js';

const router = express.Router();
router.use(authMiddleware);

const sidOf = (req) => req.auth?.sid || req.browserSession?.sid || null;
const fail = (res, status, code, error, extra = {}) => res.status(status).json({ success: false, error, code, ...extra });
const guard = (label, run) => async (req, res) => {
  try { await run(req, res); }
  catch (error) { console.error(`[account] ${label} error:`, error.message); if (!res.headersSent) res.status(500).json({ success: false, error: 'Internal server error' }); }
};
const account = async (db, userId) => (await db.query('SELECT id, email, display_name, username, password_hash FROM users WHERE id = $1', [userId])).rows[0];
const nameOf = (user) => user.display_name || user.username || 'there';
const maskEmail = (email) => { const [local, domain] = String(email).split('@'); return `${local.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`; };
const delivered = (result) => Boolean(result && result.success === true);
const sendCode = (db, user, to, code, purpose) => sendEmail(db, 'account_code', to, { displayName: nameOf(user), code, purpose, expiresIn: `${CODE_MINUTES} minutes` }, user.id).then(delivered).catch(() => false);

// ── confirm it's you ───────────────────────────────────────────────────────────────────────────────
router.get('/security', guard('security', async (req, res) => {
  const user = await account(req.db, req.user.id);
  const [confirmation, pending] = await Promise.all([confirmationStatus(req.db, { userId: user.id, sid: sidOf(req) }), pendingEmailChange(req.db, user.id)]);
  res.json({ success: true, security: { confirmation, methods: [...await twoStep.methodsFor(req.db, user.id), ...confirmMethods(user, hasUsablePassword)], has_password: hasUsablePassword(user.password_hash), email: user.email, pending_email: pending } });
}));

router.post('/confirm/code', guard('confirm code', async (req, res) => {
  const user = await account(req.db, req.user.id);
  if (!sidOf(req)) return fail(res, 403, 'confirmation_unavailable', 'This needs a signed-in browser session');
  if (hasUsablePassword(user.password_hash)) return fail(res, 400, 'use_password', 'This account confirms with its password');
  const issued = await issueCode(req.db, { userId: user.id, purpose: 'confirm', deliver: (code) => sendCode(req.db, user, user.email, code, 'confirm') });
  if (issued.tooSoon) return fail(res, 429, 'code_recently_sent', 'A code was just sent. Wait a moment before asking for another.', { retry_after: issued.retry_after });
  if (issued.undelivered) return fail(res, 503, 'mail_unavailable', 'The code could not be sent. Try again in a moment.');
  res.json({ success: true, sent_to: maskEmail(user.email), expires_in: issued.expires_in });
}));

router.post('/confirm/passkey/options', guard('confirm passkey', async (req, res) => {
  if (!sidOf(req)) return fail(res, 403, 'confirmation_unavailable', 'This needs a signed-in browser session');
  try { res.json({ success: true, ...(await twoStep.passkeyConfirmOptions(req.db, req.user.id)) }); }
  catch (e) { if (e instanceof twoStep.TwoStepError) return fail(res, e.status, e.code, e.message); throw e; }
}));
async function confirmBySecondStep(req, sid, userId) {
  const b = req.body || {};
  if (b.passkey) return (await twoStep.passkeyConfirm(req.db, userId, b.passkey)) ? confirmWithSecondStep(req.db, { userId, sid, method: 'passkey' }) : { wrong: true };
  const out = await twoStep.confirmWithFactor(req.db, userId, { authenticator: b.authenticator, recovery: b.recovery_code });
  return out.method ? confirmWithSecondStep(req.db, { userId, sid, method: out.method }) : out;
}
router.post('/confirm', guard('confirm', async (req, res) => {
  const sid = sidOf(req), userId = req.user.id;
  const result = !sid ? { unavailable: true } : (req.body?.passkey || typeof req.body?.authenticator === 'string' || typeof req.body?.recovery_code === 'string')
    ? await confirmBySecondStep(req, sid, userId)
    : typeof req.body?.code === 'string'
      ? await confirmWithCode(req.db, { userId, sid, code: req.body.code })
      : await confirmWithPassword(req.db, { userId, sid, password: req.body?.password, verifyPassword });
  if (result.ok) {
    recordSecurityEvent(req.db, EVENTS.ACCOUNT_CONFIRMED, { userId, req, metadata: { method: result.method } });
    return res.json({ success: true, confirmation: { confirmed: true, available: true, expires_at: result.expires_at, method: result.method } });
  }
  if (result.unavailable) return fail(res, 403, 'confirmation_unavailable', 'This needs a signed-in browser session');
  if (result.invalid) return fail(res, 400, 'invalid_request', 'Send your password, or the six-digit code');
  if (result.throttled) return fail(res, 429, 'too_many_attempts', 'Too many wrong tries. Wait 15 minutes and try again.');
  recordSecurityEvent(req.db, EVENTS.ACCOUNT_CONFIRM_FAILED, { userId, req, metadata: { reason: result.expired ? 'code_expired' : 'wrong' } });
  if (result.expired) return fail(res, 400, 'code_expired', 'That code has expired. Ask for a new one.');
  return fail(res, 400, typeof req.body?.code === 'string' ? 'wrong_code' : 'wrong_password', typeof req.body?.code === 'string' ? 'That code isn’t right' : 'That password isn’t right', { remaining: result.remaining });
}));

// ── email ──────────────────────────────────────────────────────────────────────────────────────────
router.post('/email', requireConfirmation(), guard('email change', async (req, res) => {
  const user = await account(req.db, req.user.id);
  const result = await requestEmailChange(req.db, { user, newEmail: req.body?.new_email, sendCode: (to, code) => sendCode(req.db, user, to, code, 'email_change') });
  if (result.ok) {
    recordSecurityEvent(req.db, EVENTS.EMAIL_CHANGE_REQUESTED, { userId: user.id, req, metadata: { new_email: result.new_email } });
    return res.json({ success: true, pending_email: { new_email: result.new_email, expires_in: result.expires_in } });
  }
  if (result.invalid) return fail(res, 400, result.code, result.code === 'same_email' ? 'That is already your address' : 'That doesn’t look like an email address');
  if (result.conflict) return fail(res, 409, result.code, 'That address can’t be used');
  if (result.tooSoon) return fail(res, 429, 'code_recently_sent', 'A code was just sent. Wait a moment before asking for another.', { retry_after: result.retry_after });
  return fail(res, 503, 'mail_unavailable', 'The code could not be sent. Try again in a moment.');
}));

router.post('/email/confirm', guard('email confirm', async (req, res) => {
  const sid = sidOf(req), userId = req.user.id;
  const before = await account(req.db, userId);
  const result = await completeEmailChange(req.db, {
    userId, code: req.body?.code,
    afterSwap: async (client, { oldEmail, newEmail }) => {
      // A changed address must not leave an old session or app token behind: whoever held them
      // signed in as the old address. This session stays; it is the one that just proved both.
      if (sid) await client.query('DELETE FROM user_sessions WHERE user_id = $1 AND id <> $2', [userId, sid]);
      else await client.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
      await revokeOidcAndResetsTransactional(client, userId);
      await recordSecurityEventTransactional(client, EVENTS.EMAIL_CHANGED, { userId, req, metadata: { old_email: oldEmail, new_email: newEmail } });
    },
  });
  if (result.ok) {
    await clearConfirmation(req.db, sid);
    // Tell the old address. Best effort and after the commit: a mail failure must not undo a change the person made.
    sendEmail(req.db, 'email_changed_notice', result.old_email, { displayName: nameOf(before), newEmailMasked: maskEmail(result.new_email), when: new Date().toUTCString(), supportUrl: `mailto:support@${mailDomain()}` }, userId).catch(() => {});
    return res.json({ success: true, email: result.new_email, other_sessions_signed_out: true });
  }
  if (result.invalid) return fail(res, 400, 'invalid_request', 'Enter the six-digit code');
  if (result.expired) return fail(res, 400, 'code_expired', 'That code has expired. Start the change again.');
  if (result.wrong) return fail(res, 400, 'wrong_code', 'That code isn’t right', { remaining: result.remaining });
  if (result.conflict) return fail(res, 409, result.code, 'That address can’t be used any more');
  return fail(res, 404, 'not_found', 'Account not found');
}));

router.delete('/email', guard('email cancel', async (req, res) => {
  res.json({ success: true, ...(await cancelEmailChange(req.db, req.user.id)) });
}));

// ── sign out everywhere ────────────────────────────────────────────────────────────────────────────
router.delete('/sessions', guard('sign out everywhere', async (req, res) => {
  const sid = sidOf(req), userId = req.user.id, all = req.query.all === '1' || !sid;
  const client = typeof req.db.connect === 'function' ? await req.db.connect() : req.db;
  let revoked = 0;
  try {
    await client.query('BEGIN');
    const gone = all
      ? await client.query('DELETE FROM user_sessions WHERE user_id = $1 RETURNING id', [userId])
      : await client.query('DELETE FROM user_sessions WHERE user_id = $1 AND id <> $2 RETURNING id', [userId, sid]);
    revoked = gone.rowCount;
    // Desktop apps and the CLI hold refresh tokens, not browser sessions. "Everywhere" includes them.
    await revokeOidcAndResetsTransactional(client, userId);
    await recordSecurityEventTransactional(client, EVENTS.SESSIONS_REVOKED_ALL, { userId, req, metadata: { browser_sessions: revoked, included_current: all } });
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { if (client !== req.db) client.release(); }
  res.json({ success: true, revoked_sessions: revoked, apps_signed_out: true, signed_out: all });
}));

// ── deleting your account ─
// ── two-step sign-in ─────────────────────────────
// Adding a way in takes a confirmation. Taking one away, or making new recovery codes, takes the second step itself.
const secondStep = requireConfirmation({ factor: true, hasSecondStep: twoStep.hasSecondStep });
const twoStepGuard = (label, run) => guard(label, async (req, res) => {
  try { await run(req, res); }
  catch (e) { if (e instanceof twoStep.TwoStepError) return fail(res, e.status, e.code, e.message); throw e; }
});
const notify = (req, user, change) => {
  recordSecurityEvent(req.db, EVENTS.TWO_STEP_CHANGED, { userId: user.id, req, metadata: { change } });
  sendEmail(req.db, 'two_step_changed', user.email, { displayName: nameOf(user), change, when: new Date().toUTCString() }, user.id).catch(() => {});
};
router.get('/two-step', twoStepGuard('two-step', async (req, res) => { res.json({ success: true, twoStep: await twoStep.status(req.db, req.user.id) }); }));
router.post('/two-step/totp', requireConfirmation(), twoStepGuard('totp begin', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, ...(await twoStep.beginTotp(req.db, await account(req.db, req.user.id))) });
}));
router.post('/two-step/totp/confirm', requireConfirmation(), twoStepGuard('totp confirm', async (req, res) => {
  const out = await twoStep.confirmTotp(req.db, req.user.id, req.body?.code);
  notify(req, await account(req.db, req.user.id), 'An authenticator app was turned on');
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, ...out });
}));
router.delete('/two-step/totp', secondStep, twoStepGuard('totp off', async (req, res) => {
  const out = await twoStep.removeTotp(req.db, req.user.id);
  if (out.removed) notify(req, await account(req.db, req.user.id), 'Your authenticator app was turned off');
  res.json({ success: true, ...out });
}));
router.post('/two-step/recovery-codes', secondStep, twoStepGuard('recovery codes', async (req, res) => {
  const codes = await twoStep.newRecoveryCodes(req.db, req.user.id);
  notify(req, await account(req.db, req.user.id), 'New recovery codes were made, and the old ones stopped working');
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, recoveryCodes: codes });
}));
router.post('/two-step/passkeys/options', requireConfirmation(), twoStepGuard('passkey options', async (req, res) => {
  res.json({ success: true, ...(await twoStep.passkeyRegistrationOptions(req.db, await account(req.db, req.user.id))) });
}));
router.post('/two-step/passkeys', requireConfirmation(), twoStepGuard('passkey add', async (req, res) => {
  const out = await twoStep.addPasskey(req.db, req.user.id, req.body || {});
  notify(req, await account(req.db, req.user.id), 'A passkey was added');
  res.set('Cache-Control', 'no-store');
  res.status(201).json({ success: true, ...out });
}));
router.patch('/two-step/passkeys/:id', twoStepGuard('passkey rename', async (req, res) => { res.json({ success: true, ...(await twoStep.renamePasskey(req.db, req.user.id, req.params.id, req.body?.name)) }); }));
router.delete('/two-step/passkeys/:id', secondStep, twoStepGuard('passkey remove', async (req, res) => {
  const out = await twoStep.removePasskey(req.db, req.user.id, req.params.id);
  notify(req, await account(req.db, req.user.id), 'A passkey was removed');
  res.json({ success: true, ...out });
}));

// ── apps signed in with this account ─────────────────────────────
router.get('/apps', guard('apps', async (req, res) => { res.json({ success: true, apps: await listApps(req.db, req.user.id) }); }));
router.delete('/apps/:clientId', guard('app removal', async (req, res) => {
  const out = await removeApp(req.db, req.user.id, req.params.clientId);
  if (out.notFound) return fail(res, 404, 'app_not_found', 'That app has no access to your account');
  res.json({ success: true, ...out });
}));

router.get('/deletion', guard('deletion status', async (req, res) => { res.json({ success: true, deletion: await deletion.status(req.db, req.user.id) }); }));
router.post('/deletion', requireConfirmation(), guard('deletion request', async (req, res) => {
  const r = await deletion.request(req.db, req.user.id);
  if (!r.ok) return fail(res, 409, r.blockers[0].code, r.blockers[0].message, { blockers: r.blockers });
  await recordSecurityEvent(req.db, EVENTS.ACCOUNT_DELETION_REQUESTED, { userId: req.user.id, req, metadata: { erase_at: r.deletion.eraseAt } });
  const user = await account(req.db, req.user.id);
  await sendEmail(req.db, 'account_deletion', user.email, { displayName: nameOf(user), eraseAt: r.deletion.eraseAt }, user.id).catch((e) => console.error('[account] deletion mail not sent:', e.message));
  res.json({ success: true, deletion: r.deletion });
}));
router.delete('/deletion', guard('deletion cancel', async (req, res) => {
  const r = await deletion.cancel(req.db, req.user.id);
  if (r.cancelled) await recordSecurityEvent(req.db, EVENTS.ACCOUNT_DELETION_CANCELLED, { userId: req.user.id, req });
  res.json({ success: true, deletion: null });
}));

// ── a copy of your data ────────────────────────────────────────────────────────────────────────────
router.get('/exports', guard('exports', async (req, res) => {
  res.json({ success: true, exports: await listExports(req.db, req.user.id) });
}));

router.post('/exports', requireConfirmation(), guard('export request', async (req, res) => {
  const result = await requestExport(req.db, req.user.id);
  if (result.ok) {
    recordSecurityEvent(req.db, EVENTS.DATA_EXPORT_REQUESTED, { userId: req.user.id, req, metadata: { export_id: result.export.id } });
    return res.status(202).json({ success: true, export: result.export });
  }
  return fail(res, 409, result.code, result.code === 'export_in_progress' ? 'A copy is already being made' : `You can ask for ${result.limit} copies a day`, result.limit ? { limit: result.limit } : {});
}));

router.get('/exports/:id/download', guard('export download', async (req, res) => {
  // The file is the person's whole account. An API key may not fetch it; a browser session may.
  if (!sidOf(req)) return fail(res, 403, 'confirmation_unavailable', 'This needs a signed-in browser session');
  const file = await exportFile(req.db, { userId: req.user.id, exportId: req.params.id });
  if (!file) return fail(res, 404, 'not_found', 'That copy is not available');
  recordSecurityEvent(req.db, EVENTS.DATA_EXPORT_DOWNLOADED, { userId: req.user.id, req, metadata: { export_id: req.params.id } });
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Length', String(file.size));
  res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(file.path).on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); }).pipe(res);
}));

router.delete('/exports/:id', guard('export delete', async (req, res) => {
  const result = await deleteExport(req.db, { userId: req.user.id, exportId: req.params.id });
  return result.ok ? res.json({ success: true }) : fail(res, 404, 'not_found', 'That copy is not available');
}));

export default router;
