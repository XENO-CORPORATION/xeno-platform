/**
 * Keep the COUNTRY a sign-in came from, so XENO Places can stand a workspace's building in the right city when the
 * owner never set Language & region.
 *
 * Source: Cloudflare's `CF-IPCountry` (ISO 3166-1 alpha-2), which Cloudflare sets on every proxied request and strips
 * from client input — the same trust basis as `CF-Connecting-IP` in clientIp.js. Only the two letters are kept; the IP
 * is not stored for this. Cloudflare's own non-countries (`XX` unknown, `T1` Tor) are ignored.
 *
 * Written to settings.workspace.region = { …, region: 'DE', source: 'signin_country' } — the record places_home_city()
 * reads — and ONLY when the person has not set a country themselves (no region, or one we wrote). A value the person
 * chose is never overwritten. Best effort: a failure here never fails a sign-in.
 */
export function countryFromRequest(req) {
  const raw = String(req?.get?.('CF-IPCountry') || req?.headers?.['cf-ipcountry'] || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(raw) || raw === 'XX' || raw === 'T1') return null;
  return raw;
}

export async function recordSigninCountry(db, userId, req) {
  const cc = countryFromRequest(req);
  if (!cc || !userId) return false;
  try {
    const r = await db.query(
      `INSERT INTO user_settings (user_id, settings, updated_at)
         VALUES ($1, jsonb_build_object('workspace', jsonb_build_object('region', jsonb_build_object('region', $2::text, 'source', 'signin_country'))), now())
       ON CONFLICT (user_id) DO UPDATE SET
         settings = jsonb_set(
           jsonb_set(CASE WHEN jsonb_typeof(user_settings.settings) = 'object' THEN user_settings.settings ELSE '{}'::jsonb END, '{workspace}',
             CASE WHEN jsonb_typeof(user_settings.settings->'workspace') = 'object' THEN user_settings.settings->'workspace' ELSE '{}'::jsonb END),
           '{workspace,region}',
           (CASE WHEN jsonb_typeof(user_settings.settings#>'{workspace,region}') = 'object' THEN user_settings.settings#>'{workspace,region}' ELSE '{}'::jsonb END)
             || jsonb_build_object('region', $2::text, 'source', 'signin_country')),
         updated_at = now()
       WHERE (user_settings.settings #>> '{workspace,region,region}') IS NULL
          OR (user_settings.settings #>> '{workspace,region,source}') = 'signin_country'`,
      [userId, cc],
    );
    return r.rowCount > 0;
  } catch (e) {
    console.warn('[signinCountry] not recorded:', e.message);
    return false;
  }
}
