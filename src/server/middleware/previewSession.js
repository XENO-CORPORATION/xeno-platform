import crypto from 'node:crypto';
import { PREVIEW_COOKIE, PREVIEW_CSRF_COOKIE, PREVIEW_MODE, PREVIEW_POLICY_VERSION,
  PREVIEW_LIFETIME_SECONDS, previewOperation } from '../../lib/previewPolicy.mjs';

const contexts = new WeakMap();
export const previewPrincipal = req => contexts.get(req);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const secret = () => crypto.randomBytes(32).toString('base64url');
const enabled = () => process.env.XENO_READONLY_PREVIEW_ENABLED === 'true';
const cookieOptions = (expires, httpOnly) => ({ secure: true, sameSite: 'strict', path: '/', httpOnly, expires: new Date(expires) });
const fail = (res, status, code) => res.status(status).json({ success: false, code, error: code.replaceAll('_', ' ') });

function setCookies(res, token, csrf, expires) {
  res.cookie(PREVIEW_COOKIE, token, cookieOptions(expires, true));
  res.cookie(PREVIEW_CSRF_COOKIE, csrf, cookieOptions(expires, false));
}
function clearCookies(res) {
  res.clearCookie(PREVIEW_COOKIE, cookieOptions(0, true));
  res.clearCookie(PREVIEW_CSRF_COOKIE, cookieOptions(0, false));
}

export async function issuePreviewSession(db, user, req, res) {
  if (!enabled()) throw new Error('Read-only preview is disabled');
  const client = await db.connect();
  const sid = crypto.randomUUID(), token = secret(), csrf = secret();
  let expires;
  try {
    await client.query('BEGIN');
    const result = await client.query(`INSERT INTO user_sessions (id,user_id,token_hash,expires_at,user_agent)
      VALUES ($1,$2,$3,NOW() + $4 * INTERVAL '1 second',$5) RETURNING expires_at`,
      [sid, user.id, hash(token), PREVIEW_LIFETIME_SECONDS, req.get('user-agent')]);
    expires = result.rows[0].expires_at;
    await client.query(`INSERT INTO browser_session_state(sid,csrf_hash,purpose,absolute_expires_at)
      VALUES ($1,$2,'preview_readonly',$3)`, [sid, hash(csrf), expires]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
  setCookies(res, token, csrf, expires);
}

async function readConnection(pool, req, res) {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN READ ONLY');
    await connection.query("SET LOCAL statement_timeout = '10s'");
  } catch (error) { await connection.query('ROLLBACK').catch(() => {}); connection.release(true); throw error; }
  if (res.destroyed || res.writableEnded) { await connection.query('ROLLBACK'); connection.release(); return false; }
  let ended = false;
  const wrapper = {
    previewReadOnly: true,
    query: (sql, values) => {
      if (ended) return Promise.reject(new Error('Preview read is closed'));
      const text = typeof sql === 'string' ? sql.trim().replace(/;$/, '') : '';
      if (!/^(SELECT|WITH)\b/i.test(text) || text.includes(';')) return Promise.reject(new Error('Preview database writes are forbidden'));
      return connection.query(sql, values);
    },
    connect: async () => wrapper,
    release: () => {},
  };
  req.previewReadDb = wrapper;
  req.db = wrapper;
  const finish = () => {
    if (ended) return;
    ended = true;
    void connection.query('ROLLBACK').then(() => connection.release(), () => connection.release(true));
  };
  res.once('finish', finish); res.once('close', finish);
  return true;
}

/** Mounted at the application root before any API route. No preview JWT is minted. */
export function previewSessionMiddleware(pool) {
  return async (req, res, next) => {
    const pairs = String(req.headers.cookie || '').split(';').map(x => x.trim()).filter(Boolean);
    const tokenPairs = pairs.filter(p => p.startsWith(`${PREVIEW_COOKIE}=`));
    const csrfPairs = pairs.filter(p => p.startsWith(`${PREVIEW_CSRF_COOKIE}=`));
    const mode = req.get('x-xeno-session-mode');
    const operation = previewOperation(req.method, req.originalUrl || req.url, req.headers);
    if (operation === 'policy' && !tokenPairs.length) return res.set('Cache-Control', 'no-store').status(enabled() ? 200 : 503)
      .json({ success: enabled(), mode: PREVIEW_MODE, policyVersion: PREVIEW_POLICY_VERSION, enabled: enabled() });
    if (!tokenPairs.length) {
      if (mode !== PREVIEW_MODE) return next();
      if (!enabled()) return fail(res, 503, 'preview_disabled');
      if (operation !== 'login' || req.headers.authorization || pairs.some(p => /^(?:__Host-)?xeno_session=/.test(p))) return fail(res, 403, 'preview_operation_forbidden');
      return next(); // existing password verifier, then issuePreviewSession
    }
    res.set('Cache-Control', 'no-store');
    res.set('X-Xeno-Preview-Policy', PREVIEW_POLICY_VERSION);
    try {
      if (!enabled()) return fail(res, 503, 'preview_disabled');
      if (tokenPairs.length !== 1 || csrfPairs.length > 1 || req.headers.authorization ||
          pairs.some(p => /^(?:__Host-)?xeno_session=/.test(p))) return fail(res, 400, 'ambiguous_preview_credentials');
      const token = tokenPairs[0].slice(PREVIEW_COOKIE.length + 1);
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return fail(res, 401, 'preview_session_invalid');
      const result = await pool.query(`SELECT us.id AS sid, us.user_id, bss.csrf_hash,bss.absolute_expires_at,
        u.id,u.username,u.email,u.display_name,u.avatar_url,u.created_at,u.email_verified,u.is_active,u.credits,u.bonus_credits_claimed
        FROM user_sessions us JOIN browser_session_state bss ON bss.sid=us.id JOIN users u ON u.id=us.user_id
        WHERE us.token_hash=$1 AND us.expires_at>NOW() AND bss.purpose='preview_readonly'
        AND bss.absolute_expires_at>NOW() AND u.is_active=true`, [hash(token)]);
      const row = result.rows[0];
      if (!row) return fail(res, 401, 'preview_session_invalid');
      if (!operation || operation === 'login' || operation === 'policy') return fail(res, 403, 'preview_operation_forbidden');
      const { sid, user_id, csrf_hash, absolute_expires_at, ...user } = row;
      const context = { user, sid, absoluteExpiresAt: absolute_expires_at };
      contexts.set(req, context); req.user = user;
      if (operation === 'read') {
        if (req.path === '/api/auth/validate') return res.json({ success: true, user, preview: { mode: PREVIEW_MODE, policyVersion: PREVIEW_POLICY_VERSION } });
        if (await readConnection(pool, req, res)) return next();
        return;
      }
      const csrf = csrfPairs[0]?.slice(PREVIEW_CSRF_COOKIE.length + 1);
      if (!csrf || !equal(csrf, req.get('x-xeno-csrf')) || !equal(hash(csrf), csrf_hash)) return fail(res, 403, 'preview_csrf_invalid');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const locked = await client.query(`SELECT us.id,bss.csrf_hash,bss.absolute_expires_at FROM user_sessions us
          JOIN browser_session_state bss ON bss.sid=us.id WHERE us.id=$1 AND us.token_hash=$2
          AND us.expires_at>NOW() AND bss.absolute_expires_at>NOW() AND bss.purpose='preview_readonly' FOR UPDATE OF us,bss`, [sid, hash(token)]);
        if (!locked.rows.length || locked.rows[0].csrf_hash !== csrf_hash) {
          await client.query('ROLLBACK'); return fail(res, 409, 'preview_session_rotated');
        }
        if (operation === 'logout') {
          await client.query('DELETE FROM user_sessions WHERE id=$1', [sid]);
          await client.query('COMMIT'); clearCookies(res);
        } else {
          const replacement = secret(), nextCsrf = secret();
          await client.query('UPDATE user_sessions SET token_hash=$1 WHERE id=$2', [hash(replacement), sid]);
          await client.query('UPDATE browser_session_state SET csrf_hash=$1,rotated_at=NOW() WHERE sid=$2', [hash(nextCsrf), sid]);
          await client.query('COMMIT'); setCookies(res, replacement, nextCsrf, absolute_expires_at);
        }
        return res.json({ success: true, authenticated: operation !== 'logout', preview: { mode: PREVIEW_MODE, policyVersion: PREVIEW_POLICY_VERSION } });
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    } catch { return fail(res, 503, 'preview_session_unavailable'); }
  };
}
