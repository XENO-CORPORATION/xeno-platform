/**
 * GDPR erasure vs the immutable ledger (Arch §6.2).
 *
 * The hash-chained money journal (credit_transactions) carries NO PII — only an
 * opaque user_id + amounts + hashes — so PII already lives OFF the ledger. Erasure
 * therefore tombstones the PII (users + external_identity_links) and revokes all
 * tokens, while the financial facts stay intact and the chain stays verifiable.
 * (This is the segregation form of crypto-shredding: destroy the PII, keep the
 * facts. Equivalent guarantee, no per-field key management, because the immutable
 * data has no PII to shred in the first place.)
 */
import { eraseForumContent } from '../services/forumWrite.js';

export async function eraseSubject(pool, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 1. Tombstone PII on the canonical user (keep the row + id for FK/ledger
    //    integrity). display_name/username are NOT NULL on live, so tombstone to
    //    a non-identifying, id-derived sentinel rather than NULL.
    await client.query(
      `UPDATE users
          SET email = 'erased+' || id || '@erased.invalid',
              display_name = 'Erased User',
              username = 'erased_' || replace(id::text, '-', ''),
              avatar_url = NULL,
              is_active = false
        WHERE id = $1`,
      [userId],
    );
    // 2. Delete external identity links (they carry external_email).
    const links = await client.query('DELETE FROM external_identity_links WHERE platform_user_id = $1', [userId]);
    // 3. Revoke every token/session.
    await client.query('UPDATE oauth_refresh_tokens SET revoked = true WHERE user_id = $1', [userId]).catch(() => {});
    // 3b. Delete session rows outright: they carry PII (ip_address, user_agent) and —
    //     in legacy rows — a PLAINTEXT JWT in session_token. This also instantly kills
    //     every session-backed (sid) token the subject still holds. No .catch(): a
    //     failure inside the transaction must abort the erasure loudly, not report a
    //     half-erased subject as erased.
    await client.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
    // 4. credit_transactions + credit_grants are KEPT — no PII, just opaque ids +
    //    amounts; the §5 hash chain remains valid after erasure.
    // 5. Authored forum CONTENT. Step 1 tombstones the byline, which is not the
    //    same thing: a post body is free text written by the subject and
    //    routinely contains their own personal data. Anonymising the author
    //    while leaving "my number is …" published is not erasure.
    //    Other people's posts are KEPT — erasing them on one person's request
    //    would destroy third-party data. Inside this transaction on purpose: a
    //    failure must roll back the identity tombstone rather than report a
    //    half-erased subject as erased.
    const forum = await eraseForumContent(client, userId);
    await client.query('COMMIT');
    return {
      erased: true, userId, linksRemoved: links.rowCount, ledgerPreserved: true,
      ...forum,
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
