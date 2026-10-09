/* platform-usage.js — on the platform, the Usage button and its popover show the person's real credits.
 *
 * The picture ships a sample (2,480 credits available, two held jobs, spending by product and model) so the
 * popover has something to draw from disk. Served by the platform that sample was shown as the signed-in
 * person's own balance. Here the source is replaced with what the platform holds:
 *
 *   balance   GET /api/billing/overview                      → overview.credits.balance
 *   spending  GET /api/v2/ledger/usage?from=&groupBy=surface|model, for the last day, 7 and 30 days (the popover's own ranges)
 *
 * What the platform does not report is left out, not invented: no held jobs, no "Recent" list. If the balance
 * cannot be read the popover says so (the page's own error plate) and the button shows a dash.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_USAGE_LIVE = { served: false }; return; }
  const api = P.api, MICRO = 1e6, DAYS = { '24h': 1, '7d': 7, '30d': 30 }, GROUPS = ['surface', 'model'];
  const S = { status: 'loading', balance: null };
  // The popover is a glance: the five that cost most, and one line for the rest (a real account has used ~90 models).
  const TOP = 5;
  const top = (rows) => { const s = rows.slice().sort((a, b) => b[1] - a[1]); if (s.length <= TOP + 1) return s; const rest = s.slice(TOP);
    return [...s.slice(0, TOP), [`${rest.length} others`, rest.reduce((n, r) => n + r[1], 0), rest.reduce((n, r) => n + r[2], 0)]]; };
  async function usage() {
    const now = Date.now();
    const asks = Object.entries(DAYS).flatMap(([range, days]) => GROUPS.map((group) => [range, group, api('GET', `/api/v2/ledger/usage?from=${encodeURIComponent(new Date(now - days * 86400000).toISOString())}&groupBy=${group}`).catch(() => null)]));
    const [bill, ...parts] = await Promise.all([api('GET', '/api/billing/overview').catch(() => null), ...asks.map((a) => a[2])]);
    const credits = bill && bill.ok && bill.d.overview ? bill.d.overview.credits : null;
    if (!credits || !Number.isFinite(Number(credits.balance))) { S.status = 'error'; S.balance = null; throw new Error('balance unavailable'); }
    const byRange = {};
    asks.forEach(([range, group], i) => { const r = parts[i]; (byRange[range] = byRange[range] || {})[group] = r && r.ok && Array.isArray(r.d.rows)
      ? top(r.d.rows.filter((x) => Number(x.costMicro) > 0).map((x) => [String(x.key || 'other'), Number(x.costMicro) || 0, Number(x.events) || 0])) : null; });
    const balance = Number(credits.balance);
    S.status = 'ready'; S.balance = balance;
    return { real: true, availableMicro: balance * MICRO, postedMicro: balance * MICRO, frozen: false, held: [], by: { surface: byRange['30d'].surface || [], model: byRange['30d'].model || [] }, byRange, activity: null };
  }
  window.XENO_SRC = Object.assign(window.XENO_SRC || {}, { usage });
  window.XENO_USAGE_LIVE = { served: true, state: () => ({ status: S.status, balance: S.balance }) };
})();
