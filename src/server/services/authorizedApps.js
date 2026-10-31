/**
 * The apps signed in with a person's XENO account, and taking that access away.
 *
 * The refresh tokens are the record: an app is listed while it can still get a new access token. Each sign-in has its
 * own session (utils/oidcProvider.js gives every grant a new sid), so ending those sessions ends the app's access
 * tokens at once rather than when they run out. A session another app also holds stays, and only this app's tokens
 * go: that app has done nothing wrong. An agent's own credentials are on its agent page, not here.
 */
import { emitBackchannelLogout } from '../utils/oidcProvider.js';
import { recordSecurityEventAsync, EVENTS } from './securityEvents.js';

const WORDS = {
  profile: 'your name and photo', email: 'your email address',
  'inference:run': 'use AI on your credits', 'ledger:read': 'see your credit balance', 'ledger:spend': 'spend your credits',
  'storage:read': 'read your files', 'storage:write': 'change your files', 'projects:read': 'read your projects', 'projects:write': 'change your projects',
  'tasks:read': 'read your tasks', 'tasks:write': 'change your tasks', 'team:read': 'see your teams', 'team:manage': 'manage your teams',
  'workforce:read': 'see your agents', 'workforce:manage': 'manage your agents', 'billing:read': 'see your billing', 'billing:manage': 'manage your billing',
  'connect:read': 'see your connected services', 'connect:use': 'use your connected services', 'connect:manage': 'manage your connected services',
  'browser:connect': 'connect your browser', 'marketplace:payout': 'manage your seller payouts', 'collaboration:use': 'join shared sessions', 'sync:use': 'sync your work',
};

export function scopeWords(scopes) {
  const out = [];
  for (const s of scopes) { const w = WORDS[s]; if (w && !out.includes(w)) out.push(w); }
  return out;
}

// `rotated` tokens are the ones a newer token replaced, so they say nothing about whether the app is still signed in.
const LIVE = `rt.user_id = $1 AND NOT rt.revoked AND NOT rt.rotated AND rt.expires_at > now() AND rt.client_id NOT LIKE 'agent:%'`;

export async function listApps(db, userId) {
  const { rows } = await db.query(
    `SELECT rt.client_id, COALESCE(MAX(m.client_name), MAX(c.name), rt.client_id) AS name, COALESCE(BOOL_OR(c.is_first_party), false) AS first_party,
            COUNT(DISTINCT rt.sid)::int AS sessions, MAX(rt.created_at) AS last_used, MIN(rt.created_at) AS since, string_agg(DISTINCT rt.scope, ' ') AS scope
       FROM oauth_refresh_tokens rt
       LEFT JOIN oauth_clients c ON c.client_id = rt.client_id
       LEFT JOIN oauth_session_state s ON s.sid = rt.sid AND s.user_id = rt.user_id
       LEFT JOIN mcp_connections m ON m.client_id = rt.client_id AND m.owner_user_id = rt.user_id AND m.revoked_at IS NULL
      WHERE ${LIVE} AND (s.sid IS NULL OR (s.revoked_at IS NULL AND s.expires_at > now()))
      GROUP BY rt.client_id
      ORDER BY MAX(rt.created_at) DESC`,
    [userId],
  );
  return rows.map((r) => ({ clientId: r.client_id, name: r.name, firstParty: r.first_party, sessions: r.sessions, lastUsedAt: r.last_used, since: r.since, can: scopeWords(new Set(String(r.scope || '').split(/\s+/).filter(Boolean))) }));
}

/** Every session and token this app holds for this person. Nothing listed for them answers as nothing found. */
export async function removeApp(db, userId, clientId) {
  const id = String(clientId || '');
  if (!id || id.length > 200 || id.startsWith('agent:')) return { notFound: true };
  const tx = await db.connect();
  let ended = [];
  try {
    await tx.query('BEGIN');
    const held = (await tx.query(`SELECT DISTINCT rt.sid FROM oauth_refresh_tokens rt WHERE ${LIVE} AND rt.client_id = $2`, [userId, id])).rows.map((r) => r.sid).filter(Boolean);
    const linked = await tx.query('UPDATE mcp_connections SET revoked_at = now() WHERE owner_user_id = $1 AND client_id = $2 AND revoked_at IS NULL', [userId, id]);
    if (!held.length && !linked.rowCount) { await tx.query('ROLLBACK'); return { notFound: true }; }
    await tx.query('UPDATE oauth_refresh_tokens SET revoked = true WHERE user_id = $1 AND client_id = $2 AND NOT revoked', [userId, id]);
    // a session only this app holds ends now, so its access tokens stop on their next use
    ended = (await tx.query(
      `UPDATE oauth_session_state s SET revoked_at = COALESCE(s.revoked_at, now())
        WHERE s.user_id = $1 AND s.sid = ANY($2::uuid[])
          AND NOT EXISTS (SELECT 1 FROM oauth_refresh_tokens o WHERE o.sid = s.sid AND o.user_id = s.user_id AND o.client_id <> $3 AND NOT o.revoked AND NOT o.rotated AND o.expires_at > now())
        RETURNING s.sid`,
      [userId, held, id],
    )).rows.map((r) => r.sid);
    await tx.query('COMMIT');
  } catch (e) {
    await tx.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { tx.release(); }
  recordSecurityEventAsync(db, EVENTS.TOKEN_REVOKED, { userId, metadata: { by: 'app_removed', clientId: id, sessionCount: ended.length } });
  await Promise.all(ended.map((sid) => emitBackchannelLogout(db, sid).catch(() => {})));
  return { removed: true, sessions: ended.length };
}
