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
    const result = await eraseSubjectTx(client, userId, { agentsErased: 0 });
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * The erasure itself, on a client the caller owns. Recursive: a human's AGENTS
 * are subjects of their own (their handle embeds the owner's username, they hold
 * keys, they may have posted) and are erased with the owner — an agent cannot
 * outlive its owner, and an orphaned active agent with a working key is exactly
 * what the hard DELETE used to leave behind (dogfooding 2026-09-17, F23).
 */
export async function eraseSubjectTx(client, userId, acc) {
  {
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
    // 3c. THE PROVIDER-KEY VAULT. Step 1 tombstones `users` rather than deleting
    //     the row, so the ON DELETE CASCADE on user_provider_credentials never
    //     fires — measured 2026-09-17: a provider key would have SURVIVED erasure.
    //     A customer's OpenAI/Anthropic key is the most sensitive thing we hold
    //     for them; Art. 17 is not satisfied while it sits in our vault.
    //     Order matters: inference_routes.credential_id is ON DELETE RESTRICT (D10,
    //     so a live product can never lose its key by cascade), so routes go
    //     first; then credentials, which cascade inference_grants. No .catch():
    //     a failure here must abort the erasure, not report a half-erased subject.
    const routes = await client.query('DELETE FROM inference_routes WHERE user_id = $1', [userId]);
    const credentials = await client.query('DELETE FROM user_provider_credentials WHERE user_id = $1', [userId]);
    // 3d. Usage rows are FACTS (tokens, model, cost) and stay, like the ledger —
    //     but they also carry ip_address, user_agent and request_params, which
    //     are personal data. Strip those; keep the facts.
    const usage = await client.query(
      `UPDATE api_usage_logs
          SET ip_address = NULL, user_agent = NULL, request_params = NULL
        WHERE user_id = $1
          AND (ip_address IS NOT NULL OR user_agent IS NOT NULL OR request_params IS NOT NULL)`,
      [userId],
    );
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
    // 6. Keys, mail and security rows. A developer/agent key is REVOKED (the row
    //    is an audit fact; is_active=false makes it dead by derivation). E-mail
    //    log rows keep template/status (delivery facts) and lose the address;
    //    verification tokens go; security events keep the type and lose ip/UA.
    const keys = await client.query('UPDATE api_keys SET is_active = false WHERE user_id = $1 AND is_active = true', [userId]);
    await client.query(`UPDATE email_logs SET to_email = 'erased+' || $1 || '@erased.invalid' WHERE user_id = $1 AND to_email NOT LIKE 'erased+%'`, [userId]);
    await client.query('DELETE FROM email_verifications WHERE user_id = $1', [userId]);
    await client.query('UPDATE security_events SET ip_address = NULL, user_agent = NULL WHERE user_id = $1 AND (ip_address IS NOT NULL OR user_agent IS NOT NULL)', [userId]);
    // 7. Owned agents: each is a subject; erase it, then drop the relation.
    const owned = await client.query('SELECT user_id FROM agent_identities WHERE owner_user_id = $1', [userId]);
    for (const a of owned.rows) {
      await eraseSubjectTx(client, a.user_id, acc);
      await client.query('DELETE FROM agent_identities WHERE user_id = $1', [a.user_id]);
      acc.agentsErased += 1;
    }
    return {
      erased: true, userId, linksRemoved: links.rowCount, ledgerPreserved: true,
      providerCredentialsRemoved: credentials.rowCount, routesRemoved: routes.rowCount, usageRowsScrubbed: usage.rowCount,
      keysRevoked: keys.rowCount, agentsErased: acc.agentsErased,
      ...forum,
    };
  }
}
