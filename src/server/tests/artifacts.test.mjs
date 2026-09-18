/**
 * XENO Artifacts — real-Postgres qualification of the hosted home.
 *
 * Runs the migrations, mounts the REAL routers behind the REAL authMiddleware
 * and drives the whole life of a page: create → serve under the artifact CSP +
 * sandbox → revise (unchanged bytes are not a revision) → share by link →
 * a stranger reads only via the link → comment → the owner drains the
 * undelivered queue → delete revokes everything. Storage is the filesystem
 * backend in a temp dir; the R2 backend's signing is covered separately.
 *
 * Run: DATABASE_URL=postgresql://… node tests/artifacts.test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { authMiddleware } from '../middleware/auth.js';
import { browserSessionMiddleware } from '../middleware/browserSession.js';
import artifactRoutes from '../routes/artifactRoutes.js';
import { ARTIFACT_PAGE_CSP, createArtifactViewerRouter } from '../routes/artifactViewerRoutes.js';
import { ARTIFACT_COMMENT_HOURLY_CAP, applyRetentionPolicy, retentionDaysFor, sweepExpiredArtifacts } from '../services/artifactService.js';
import { _internal as storageInternal, setArtifactStorageForTests, signV4 } from '../services/artifactStorage.js';
import { mintViewToken, verifyViewToken } from '../services/artifactViewToken.js';
import { runAllMigrations } from '../services/migrationRunner.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const PAGE_V1 = '<!doctype html><title>Sprint Board</title><link rel="stylesheet" href="style.css"><h1>Sprint 42</h1>';
const PAGE_V2 = '<!doctype html><title>Sprint Board</title><link rel="stylesheet" href="style.css"><h1>Sprint 42</h1><p>Legend</p>';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

async function main() {
  await runAllMigrations(pool);
  const storageDir = mkdtempSync(path.join(tmpdir(), 'xeno-artifacts-test-'));
  setArtifactStorageForTests(storageInternal.fsBackend(storageDir));

  const owner = (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ('art_owner', 'art-owner@xeno.test', 'Owner', true, true, 'x') RETURNING id`)).rows[0].id;
  const stranger = (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ('art_other', 'art-other@xeno.test', 'Other', true, true, 'x') RETURNING id`)).rows[0].id;
  const colleague = (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ('art_mate', 'art-mate@xeno.test', 'Mate', true, true, 'x') RETURNING id`)).rows[0].id;
  const workspaceId = (await pool.query(`INSERT INTO billing_workspaces (name, owner_user_id, workspace_type, slug) VALUES ('Team', $1, 'team', 'team-art') RETURNING id`, [owner])).rows[0].id;
  for (const [uid, role] of [[owner, 'owner'], [colleague, 'member']]) await pool.query(`INSERT INTO billing_workspace_members (workspace_id, user_id, member_role, member_status) VALUES ($1, $2, $3, 'active')`, [workspaceId, uid, role]);
  const bearer = (userId, email, username) => `Bearer ${jwt.sign({ userId, email, username }, JWT_SECRET, { expiresIn: '1h' })}`;
  const asOwner = { authorization: bearer(owner, 'art-owner@xeno.test', 'art_owner'), 'content-type': 'application/json' };
  const asStranger = { authorization: bearer(stranger, 'art-other@xeno.test', 'art_other'), 'content-type': 'application/json' };
  const asMate = { authorization: bearer(colleague, 'art-mate@xeno.test', 'art_mate'), 'content-type': 'application/json' };

  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/artifacts', authMiddleware, artifactRoutes);
  app.use('/a', browserSessionMiddleware(pool), createArtifactViewerRouter());
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = async (res) => ({ status: res.status, body: await res.json() });

  try {
    // ── create ──
    const created = await json(await fetch(`${base}/api/artifacts`, { method: 'POST', headers: asOwner, body: JSON.stringify({ html: PAGE_V1, icon: 'chart', description: 'The sprint board', sourceArtifactId: 'page_abc', files: [{ path: 'style.css', base64: b64('h1{color:red}') }] }) }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const artifact = created.body.artifact;
    assert.match(artifact.id, /^a_[A-Za-z0-9]{22}$/);
    assert.equal(artifact.title, 'Sprint Board', 'title extracted from <title>');
    assert.equal(artifact.currentRevision, 1);
    assert.equal(artifact.visibility, 'private');
    assert.equal(artifact.url, `${base}/a/${artifact.id}`);

    // ── validation refuses what the SDK refuses ──
    for (const [body, code] of [
      [{ html: '' }, 'missing_html'],
      [{ html: PAGE_V1, files: [{ path: '../x.css', base64: b64('a') }] }, 'invalid_path'],
      [{ html: PAGE_V1, files: [{ path: '/etc/passwd', base64: b64('a') }] }, 'invalid_path'],
      [{ html: PAGE_V1, files: [{ path: 'index.html', base64: b64('a') }] }, 'invalid_path'],
      [{ html: '<title>x</title>\n<p>bad \uFFFD here</p>' }, 'invalid_utf8'],
    ]) {
      const refused = await json(await fetch(`${base}/api/artifacts`, { method: 'POST', headers: asOwner, body: JSON.stringify(body) }));
      assert.equal(refused.status, 400, JSON.stringify(refused.body));
      assert.equal(refused.body.code, code);
    }
    const tooLarge = await json(await fetch(`${base}/api/artifacts`, { method: 'POST', headers: asOwner, body: JSON.stringify({ html: PAGE_V1, files: [{ path: 'big.bin', base64: Buffer.alloc(16 * 1024 * 1024).toString('base64') }] }) }));
    assert.equal(tooLarge.status, 413);

    // ── the viewer: a stranger sees nothing, not even that it exists ──
    const anon = await fetch(`${base}/a/${artifact.id}`);
    assert.equal(anon.status, 401, 'no session → sign-in page');
    assert.equal(anon.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    const other = await fetch(`${base}/a/${artifact.id}`, { headers: { authorization: asStranger.authorization } });
    assert.equal(other.status, 404, 'another account gets 404, never 403');
    const otherApi = await json(await fetch(`${base}/api/artifacts/${artifact.id}`, { headers: asStranger }));
    assert.equal(otherApi.status, 404);

    // ── the owner's shell + raw files ──
    const shell = await fetch(`${base}/a/${artifact.id}`, { headers: { authorization: asOwner.authorization } });
    assert.equal(shell.status, 200);
    const shellHtml = await shell.text();
    assert.match(shellHtml, /Sprint Board/);
    const frameSrc = /src="(\/a\/a_[^"]+\/v\/[^"]+\/r\/1\/index\.html)"/.exec(shellHtml)?.[1];
    assert.ok(frameSrc, 'shell embeds a view-token raw url');
    assert.doesNotMatch(shellHtml, /xeno_session=/, 'the shell never echoes a session');
    const raw = await fetch(`${base}${frameSrc}`);
    assert.equal(raw.status, 200);
    assert.equal(raw.headers.get('content-security-policy'), ARTIFACT_PAGE_CSP);
    assert.match(ARTIFACT_PAGE_CSP, /sandbox allow-scripts/, 'raw responses run as an opaque origin');
    assert.match(ARTIFACT_PAGE_CSP, /connect-src 'none'/);
    assert.equal(raw.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(raw.headers.get('cross-origin-resource-policy'), 'cross-origin', 'an opaque-origin frame must be allowed to load its own files');
    assert.equal(await raw.text(), PAGE_V1);
    const css = await fetch(`${base}${frameSrc.replace(/index\.html$/, 'style.css')}`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /^text\/css/);
    assert.equal(await css.text(), 'h1{color:red}');
    assert.equal((await fetch(`${base}${frameSrc.replace(/index\.html$/, 'missing.css')}`)).status, 404);
    // The view token is scoped: another artifact id, another revision, or a forged signature → 401.
    assert.equal((await fetch(`${base}${frameSrc.replace('/r/1/', '/r/2/')}`)).status, 401);
    const forged = mintViewToken({ artifactId: 'a_0000000000000000000000', revision: 1 });
    assert.equal((await fetch(`${base}/a/${artifact.id}/v/${forged}/r/1/index.html`)).status, 401);
    assert.equal(verifyViewToken(mintViewToken({ artifactId: artifact.id, revision: 1, ttlSeconds: -1 })), null, 'expired tokens verify as null');
    assert.equal(verifyViewToken(`${mintViewToken({ artifactId: artifact.id, revision: 1 })}x`), null);

    // ── revise: same bytes are not a revision; new bytes are ──
    const same = await json(await fetch(`${base}/api/artifacts/${artifact.id}/revisions`, { method: 'POST', headers: asOwner, body: JSON.stringify({ html: PAGE_V1, files: [{ path: 'style.css', base64: b64('h1{color:red}') }] }) }));
    assert.equal(same.status, 200);
    assert.equal(same.body.artifact.currentRevision, 1, 'unchanged content is not a new revision');
    const revised = await json(await fetch(`${base}/api/artifacts/${artifact.id}/revisions`, { method: 'POST', headers: asOwner, body: JSON.stringify({ html: PAGE_V2, files: [{ path: 'style.css', base64: b64('h1{color:red}') }] }) }));
    assert.equal(revised.status, 201);
    assert.equal(revised.body.artifact.currentRevision, 2);
    const detail = await json(await fetch(`${base}/api/artifacts/${artifact.id}`, { headers: asOwner }));
    assert.equal(detail.body.revisions.length, 2);
    assert.equal((await fetch(`${base}${frameSrc}`)).status, 200, 'revision 1 stays readable under its token — revisions are immutable');
    const strangerRevise = await json(await fetch(`${base}/api/artifacts/${artifact.id}/revisions`, { method: 'POST', headers: asStranger, body: JSON.stringify({ html: PAGE_V2 }) }));
    assert.equal(strangerRevise.status, 404);

    // ── share by link ──
    const shared = await json(await fetch(`${base}/api/artifacts/${artifact.id}/share`, { method: 'POST', headers: asOwner, body: JSON.stringify({ visibility: 'link' }) }));
    assert.equal(shared.status, 200, JSON.stringify(shared.body));
    assert.match(shared.body.shareToken, /^s_[A-Za-z0-9]{32}$/);
    assert.equal(shared.body.shareUrl, `${base}/a/${artifact.id}?s=${shared.body.shareToken}`);
    const viaLink = await fetch(`${base}/a/${artifact.id}?s=${shared.body.shareToken}`);
    assert.equal(viaLink.status, 200, 'anyone with the link reads the shell');
    assert.match(await viaLink.text(), /shared with you/);
    assert.equal((await fetch(`${base}/a/${artifact.id}?s=s_${'x'.repeat(32)}`)).status, 401, 'a wrong link is a stranger');
    const strangerViaLink = await fetch(`${base}/a/${artifact.id}?s=${shared.body.shareToken}`, { headers: { authorization: asStranger.authorization } });
    assert.equal(strangerViaLink.status, 200);
    assert.match(await strangerViaLink.text(), /id="toAgent"/, 'a signed-in link reader gets the composer');

    // ── comments flow back to the publishing session ──
    const comment = await json(await fetch(`${base}/api/artifacts/${artifact.id}/comments`, { method: 'POST', headers: asStranger, body: JSON.stringify({ body: 'Add a legend, please', selector: '#todo', shareToken: shared.body.shareToken }) }));
    assert.equal(comment.status, 201, JSON.stringify(comment.body));
    assert.equal(comment.body.comment.revision, 2, 'a comment records the revision it was made on');
    const noLink = await json(await fetch(`${base}/api/artifacts/${artifact.id}/comments`, { method: 'POST', headers: asStranger, body: JSON.stringify({ body: 'sneaky' }) }));
    assert.equal(noLink.status, 404, 'no link → cannot comment on a page you cannot read');
    const undelivered = await json(await fetch(`${base}/api/artifacts/${artifact.id}/comments?undelivered=1`, { headers: asOwner }));
    assert.equal(undelivered.status, 200);
    assert.equal(undelivered.body.comments.length, 1);
    assert.equal(undelivered.body.comments[0].author, 'Other');
    const strangerQueue = await json(await fetch(`${base}/api/artifacts/${artifact.id}/comments?undelivered=1&s=${shared.body.shareToken}`, { headers: asStranger }));
    assert.equal(strangerQueue.status, 403, 'only the owner drains the queue');
    const ack = await json(await fetch(`${base}/api/artifacts/${artifact.id}/comments/delivered`, { method: 'POST', headers: asOwner, body: JSON.stringify({ commentIds: [comment.body.comment.id] }) }));
    assert.equal(ack.body.delivered, 1);
    const drained = await json(await fetch(`${base}/api/artifacts/${artifact.id}/comments?undelivered=1`, { headers: asOwner }));
    assert.equal(drained.body.comments.length, 0, 'acknowledged comments leave the queue');
    const all = await json(await fetch(`${base}/api/artifacts/${artifact.id}/comments`, { headers: asOwner }));
    assert.equal(all.body.comments.length, 1, '…but stay on the record');

    // ── revoke the link ──
    const revoked = await json(await fetch(`${base}/api/artifacts/${artifact.id}/share`, { method: 'POST', headers: asOwner, body: JSON.stringify({ visibility: 'private' }) }));
    assert.equal(revoked.body.artifact.visibility, 'private');
    assert.equal((await fetch(`${base}/a/${artifact.id}?s=${shared.body.shareToken}`)).status, 401, 'an old link is dead once sharing is off');

    // ── threads, notes, agent replies ──
    const rootComment = comment.body.comment;
    // Link sharing was revoked above; turn it back on (a NEW token) for the reviewers below.
    const reshared = await json(await fetch(`${base}/api/artifacts/${artifact.id}/share`, { method: 'POST', headers: asOwner, body: JSON.stringify({ visibility: 'link' }) }));
    assert.notEqual(reshared.body.shareToken, shared.body.shareToken, 're-enabling mints a new token');
    const note = await json(await fetch(`${base}/api/artifacts/${artifact.id}/comments`, { method: 'POST', headers: asStranger, body: JSON.stringify({ body: 'Note for reviewers', toAgent: false, shareToken: reshared.body.shareToken }) }));
    assert.equal(note.status, 201);
    assert.equal(note.body.comment.toAgent, false);
    const replyFromReviewer = await json(await fetch(`${base}/api/artifacts/${artifact.id}/comments`, { method: 'POST', headers: asStranger, body: JSON.stringify({ body: 'Also the footer', parentId: rootComment.id, shareToken: reshared.body.shareToken }) }));
    assert.equal(replyFromReviewer.status, 201);
    assert.equal(replyFromReviewer.body.comment.parentId, rootComment.id);
    const badParent = await json(await fetch(`${base}/api/artifacts/${artifact.id}/comments`, { method: 'POST', headers: asStranger, body: JSON.stringify({ body: 'x', parentId: replyFromReviewer.body.comment.id, shareToken: reshared.body.shareToken }) }));
    assert.equal(badParent.status, 400, 'a reply to a reply is refused — threads are one level deep');
    const queue = await json(await fetch(`${base}/api/artifacts/${artifact.id}/comments?undelivered=1`, { headers: asOwner }));
    assert.deepEqual(queue.body.comments.map((c) => c.id).sort(), [replyFromReviewer.body.comment.id].sort(), 'the note is never queued; the reply is');
    const agentReply = await json(await fetch(`${base}/api/artifacts/${artifact.id}/comments/${rootComment.id}/reply`, { method: 'POST', headers: asOwner, body: JSON.stringify({ body: 'Done — legend added in r2.' }) }));
    assert.equal(agentReply.status, 201, JSON.stringify(agentReply.body));
    assert.equal(agentReply.body.comment.authorKind, 'agent');
    assert.equal(agentReply.body.comment.parentId, rootComment.id);
    assert.equal(agentReply.body.comment.deliveredAt !== undefined, true, 'an agent reply is never queued back to the agent');
    assert.equal((await json(await fetch(`${base}/api/artifacts/${artifact.id}/comments/${rootComment.id}/reply`, { method: 'POST', headers: asStranger, body: JSON.stringify({ body: 'nope' }) }))).status, 404, 'only the owner replies as the agent');
    const shellWithThreads = await (await fetch(`${base}/a/${artifact.id}`, { headers: { authorization: asOwner.authorization } })).text();
    assert.match(shellWithThreads, /class="reply agent"/);
    assert.match(shellWithThreads, /id="toAgent"/);

    // ── workspace audience + version pinning ──
    const toWorkspace = await json(await fetch(`${base}/api/artifacts/${artifact.id}/share`, { method: 'POST', headers: asOwner, body: JSON.stringify({ visibility: 'workspace', workspaceId, sharedRevision: 1 }) }));
    assert.equal(toWorkspace.status, 200, JSON.stringify(toWorkspace.body));
    assert.equal(toWorkspace.body.artifact.visibility, 'workspace');
    assert.equal(toWorkspace.body.artifact.sharedRevision, 1);
    assert.equal(toWorkspace.body.shareToken, undefined);
    assert.equal((await fetch(`${base}/a/${artifact.id}?s=${reshared.body.shareToken}`)).status, 401, 'switching audience killed the old link');
    const mateShell = await fetch(`${base}/a/${artifact.id}`, { headers: { authorization: asMate.authorization } });
    assert.equal(mateShell.status, 200, 'an active workspace member reads without a link');
    const mateHtml = await mateShell.text();
    assert.match(mateHtml, /revision 1 · shared with your workspace/, 'the member sees the PINNED revision');
    assert.match(mateHtml, /\/r\/1\/index\.html/);
    const ownerShell = await (await fetch(`${base}/a/${artifact.id}`, { headers: { authorization: asOwner.authorization } })).text();
    assert.match(ownerShell, /revision 2 · your workspace · viewers see r1/, 'the owner always sees the latest');
    assert.equal((await fetch(`${base}/a/${artifact.id}`, { headers: { authorization: asStranger.authorization } })).status, 404, 'a non-member is still a stranger');
    const notMember = await json(await fetch(`${base}/api/artifacts/${artifact.id}/share`, { method: 'POST', headers: asOwner, body: JSON.stringify({ visibility: 'workspace', workspaceId: '00000000-0000-0000-0000-000000000000' }) }));
    assert.equal(notMember.status, 403);
    const badPin = await json(await fetch(`${base}/api/artifacts/${artifact.id}/share`, { method: 'POST', headers: asOwner, body: JSON.stringify({ visibility: 'link', sharedRevision: 9 }) }));
    assert.equal(badPin.status, 400);
    // A member's comment on the pinned revision records revision 1, not the latest.
    const mateComment = await json(await fetch(`${base}/api/artifacts/${artifact.id}/comments`, { method: 'POST', headers: asMate, body: JSON.stringify({ body: 'Looks good on r1' }) }));
    assert.equal(mateComment.status, 201);
    assert.equal(mateComment.body.comment.revision, 1);
    // Hourly cap: the 60th comment in an hour is refused with 429.
    const already = (await pool.query(`SELECT count(*)::int AS n FROM artifact_comments WHERE artifact_id=$1`, [artifact.id])).rows[0].n;
    for (let i = already; i < ARTIFACT_COMMENT_HOURLY_CAP; i++) {
      const r = await fetch(`${base}/api/artifacts/${artifact.id}/comments`, { method: 'POST', headers: asMate, body: JSON.stringify({ body: `spam ${i}` }) });
      assert.equal(r.status, 201, `comment ${i} of the cap is accepted`);
    }
    const capped = await json(await fetch(`${base}/api/artifacts/${artifact.id}/comments`, { method: 'POST', headers: asMate, body: JSON.stringify({ body: 'one too many' }) }));
    assert.equal(capped.status, 429);
    assert.equal(capped.body.code, 'comment_rate_limited');

    // ── audit + retention + kill-switch ──
    const events = (await pool.query(`SELECT event_type, metadata->>'artifactId' AS aid FROM security_events WHERE metadata->>'artifactId' = $1 ORDER BY created_at`, [artifact.id])).rows.map((r) => r.event_type);
    assert.ok(events.includes('artifact_published') && events.includes('artifact_shared'), `publish and share are audited: ${events}`);
    assert.equal(retentionDaysFor('private', { ARTIFACTS_RETENTION_DAYS_PRIVATE: 'abc' }), null, 'a malformed period keeps forever, never zero');
    assert.equal(retentionDaysFor('shared', { ARTIFACTS_RETENTION_DAYS_SHARED: '30' }), 30);
    await applyRetentionPolicy(pool, artifact.id, { ARTIFACTS_RETENTION_DAYS_SHARED: '30' });
    assert.ok((await pool.query(`SELECT expires_at FROM artifacts WHERE id=$1`, [artifact.id])).rows[0].expires_at, 'a shared page gets an expiry from policy');
    await pool.query(`UPDATE artifacts SET expires_at = NOW() - interval '1 day' WHERE id=$1`, [artifact.id]);
    const swept = await sweepExpiredArtifacts(pool);
    assert.equal(swept.expired, 1);
    assert.equal((await fetch(`${base}/a/${artifact.id}`, { headers: { authorization: asOwner.authorization } })).status, 404, 'an expired page is gone');
    process.env.ARTIFACTS_ENABLED = 'false';
    const off = await json(await fetch(`${base}/api/artifacts`, { method: 'POST', headers: asOwner, body: JSON.stringify({ html: PAGE_V1 }) }));
    assert.equal(off.status, 503);
    assert.equal(off.body.code, 'artifacts_disabled');
    process.env.ARTIFACTS_ENABLED = 'true';

    // ── content origin: raw files answer only on the user-content host ──
    process.env.ARTIFACTS_CONTENT_ORIGIN = 'http://usercontent.test';
    const second = (await json(await fetch(`${base}/api/artifacts`, { method: 'POST', headers: asOwner, body: JSON.stringify({ html: PAGE_V1 }) }))).body.artifact;
    const shell2 = await (await fetch(`${base}/a/${second.id}`, { headers: { authorization: asOwner.authorization } })).text();
    const abs = /src="(http:\/\/usercontent\.test\/a\/a_[^"]+)"/.exec(shell2)?.[1];
    assert.ok(abs, 'the shell embeds the raw url on the content origin');
    const rawPath = new URL(abs).pathname;
    assert.equal((await fetch(`${base}${rawPath}`)).status, 404, 'raw on the app host is refused when a content host is configured');
    // fetch() will not send a custom Host; go through node:http for these two.
    const viaHost = (p, headers = {}) => new Promise((resolve, reject) => { const r = http.request(`${base}${p}`, { headers: { host: 'usercontent.test', ...headers } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); r.on('error', reject); r.end(); });
    assert.equal(await viaHost(rawPath), 200, 'raw answers on the content host');
    assert.equal(await viaHost(`/a/${second.id}`, { authorization: asOwner.authorization }), 404, 'the shell never renders on the content host');
    delete process.env.ARTIFACTS_CONTENT_ORIGIN;
    await fetch(`${base}/api/artifacts/${second.id}`, { method: 'DELETE', headers: asOwner });

    // ── list + delete ──
    const fresh = (await json(await fetch(`${base}/api/artifacts`, { method: 'POST', headers: asOwner, body: JSON.stringify({ html: PAGE_V1 }) }))).body.artifact;
    const list = await json(await fetch(`${base}/api/artifacts`, { headers: asOwner }));
    assert.deepEqual(list.body.artifacts.map((a) => a.id), [fresh.id], 'expired and deleted pages are not listed');
    assert.equal((await json(await fetch(`${base}/api/artifacts`, { headers: asStranger }))).body.artifacts.length, 0);
    const deleted = await json(await fetch(`${base}/api/artifacts/${fresh.id}`, { method: 'DELETE', headers: asOwner }));
    assert.equal(deleted.body.deleted, true);
    assert.equal((await fetch(`${base}/a/${fresh.id}`, { headers: { authorization: asOwner.authorization } })).status, 404, 'deleted is gone for the owner too');
    assert.ok((await pool.query(`SELECT 1 FROM security_events WHERE event_type='artifact_deleted' AND metadata->>'artifactId'=$1`, [fresh.id])).rows[0], 'delete is audited');
    assert.equal((await fetch(`${base}${frameSrc}`)).status, 200, 'a still-valid view token reads the immutable revision until it expires (≤1h)');

    // ── R2 request signing is deterministic and shaped like SigV4 ──
    const signed = signV4({ method: 'PUT', host: 'acct.r2.cloudflarestorage.com', canonicalUri: '/xeno-artifacts/artifacts/a_x/r1/index.html', headers: { host: 'acct.r2.cloudflarestorage.com', 'x-amz-content-sha256': 'abc', 'x-amz-date': '20260918T000000Z' }, payloadHash: 'abc', accessKeyId: 'AKID', secretAccessKey: 'SECRET', now: new Date('2026-09-18T00:00:00Z') });
    assert.match(signed.authorization, /^AWS4-HMAC-SHA256 Credential=AKID\/20260918\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    assert.throws(() => storageInternal.assertKey('artifacts/a_x/r1/../../etc'), /Refusing/);
    assert.throws(() => storageInternal.assertKey('other/a_x/r1/index.html'), /Refusing/);

    console.log('artifacts: all assertions passed');
  } finally {
    server.close();
    await pool.end();
    rmSync(storageDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
