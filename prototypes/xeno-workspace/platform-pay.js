/* platform-pay.js — People › Pay: how workspace members are paid (owner, 2026-10-29: "Agreements + credits, a person
 * approves"). Served by /api/compensation (routes/compensationRoutes.js → services/workforceCompensation.js).
 *
 *   Pay        /workspace/workspace/Directory/pay/<period start YYYY-MM-DD>/<week|month>   (default: last month)
 *
 * A workspace administrator prepares a period's payouts from each member's agreement and work report, then
 * approves (optionally with another amount) or skips each one; approving pays credits from the workspace
 * wallet. Agreements are set and ended here; salaries paid outside XENO are recorded for the CSV export.
 * Everyone else sees only their own agreement and payouts. The counts PREPARE a payout; a person decides it.
 */
(() => {
  const P = window.XENO_PLATFORM;
  if (!P || !P.served) { window.XENO_PAY = { served: false, route: () => null }; return; }
  const X = () => window.XW, H = () => window.XENO_PAGES.h, D = () => window.XD;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = (...a) => P.api(...a).catch(() => ({ ok: false, d: {} }));
  const toast = (m) => X()?.toast?.(m);
  const paint = () => { try { X()?.render?.(); } catch {} };
  const go = (item) => X()?.go?.('global', { global: 'workspace', item });
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ws = () => { const u = window.XENO_SCOPE?.uuid?.(); if (u && UUID.test(String(u))) return String(u); const w = window.XA?.currentWorkspace?.(); const id = w && (w.uuid || w.id); return id && UUID.test(String(id)) ? String(id) : ''; };
  const cr = (micro) => { const v = Number(BigInt(String(micro || '0')) / 10000n) / 100; return v.toLocaleString(undefined, { maximumFractionDigits: 2 }); };
  const toMicro = (credits) => { const n = Number(String(credits).replace(',', '.')); return Number.isFinite(n) && n >= 0 ? String(Math.round(n * 100)) + '0000' : null; };
  const S = { key: null, status: 'idle', agreements: [], payouts: [], canManage: false, people: [] };
  const BASIS = { per_period: 'Fixed per period', per_accepted_task: 'Per task a person accepted', revenue_share: 'Share of revenue', salary_recorded: 'Salary (paid outside XENO)' };
  const STATE = { prepared: 'Waiting for a decision', approved: 'Approved — waiting for wallet funds', paid: 'Paid', skipped: 'Skipped' };
  const lastMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); };
  const shift = (start, period, by) => { const d = new Date(`${start}T00:00:00Z`); if (period === 'week') d.setUTCDate(d.getUTCDate() + 7 * by); else d.setUTCMonth(d.getUTCMonth() + by); return d.toISOString().slice(0, 10); };
  const label = (start, period) => (period === 'week' ? `Week of ${new Date(`${start}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : new Date(`${start}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }));
  const nameOf = (id) => S.people.find((p) => p.id === id)?.name || (P.user && String(P.user.id) === id ? (P.user.display_name || P.user.username) : 'Member');

  async function load() {
    const at = S.key, w = ws();
    if (!w) { if (window.XENO_SCOPE && window.XENO_SCOPE.status?.() !== 'ready') { setTimeout(() => { if (S.key === at) load(); }, 250); return; } S.status = 'nows'; return paint(); }
    const [a, p, people] = await Promise.all([api('GET', `/api/compensation/agreements?workspace=${w}`), api('GET', `/api/compensation/payouts?workspace=${w}`), api('GET', `/api/people?workspace=${w}`)]);
    if (S.key !== at) return;
    if (!a.ok || !p.ok) { S.status = (a.status === 404 || p.status === 404) ? 'none' : 'error'; return paint(); }
    S.agreements = a.d.agreements || []; S.payouts = p.d.payouts || []; S.canManage = !!a.d.canManage; S.people = people.ok ? people.d.people || [] : [];
    S.status = 'ready'; paint();
  }

  function page(start, period) {
    const h = H(), m = S.canManage;
    const tabs = h.tabs([['Directory', 'Directory'], ['Directory/org-chart', 'Org chart'], ['Directory/my-work', 'My work'], ['Directory/pay', 'Pay']], 'Directory/pay', 'data-xdir="tab" data-to');
    const inPeriod = S.payouts.filter((x) => x.periodStart === start);
    const prev = shift(start, period, -1), next = shift(start, period, 1);
    const ended = Date.parse(`${shift(start, period, 1)}T00:00:00Z`) <= Date.now();
    const acts = m ? [ended ? h.btn('Prepare payouts', `data-xpay="prepare" data-s="${start}" data-p="${period}"`, false, 'check') : '',
      h.btn('Set pay', 'data-xpay="set"', true, 'plus'), `<a class="pg-btn pg-btn--ghost" href="/api/compensation/export.csv?workspace=${esc(ws())}&periodStart=${start}&period=${period}" download>Export CSV</a>`].join('') : '';
    const nav = `<div class="xpay-nav">${h.btn('←', `data-xdir="tab" data-to="Directory/pay/${prev}/${period}"`, true)}<b>${esc(label(start, period))}</b>${ended ? '' : '<span class="pg-dim">still running</span>'}${h.btn('→', `data-xdir="tab" data-to="Directory/pay/${next}/${period}"`, true)}
      <span class="pg-sp"></span>${['month', 'week'].map((x) => `<button class="pg-link${x === period ? ' is-on' : ''}" data-xdir="tab" data-to="Directory/pay/${x === 'week' ? shift(start, 'week', 0) : start.slice(0, 8) + '01'}/${x}">${x === 'week' ? 'Weeks' : 'Months'}</button>`).join(' ')}</div>`;
    const why = (e) => (e.basis === 'per_accepted_task' ? `${e.acceptedByHuman} task${e.acceptedByHuman === 1 ? '' : 's'} a person accepted${e.neverReviewed ? ` · ${e.neverReviewed} finished without review (not paid)` : ''}`
      : e.basis === 'revenue_share' ? 'No revenue is recorded for members yet' : 'Fixed for the period');
    const rows = inPeriod.map((x) => h.tr('', [`<b class="pg-name">${esc(nameOf(x.principalId))}</b>${x.payeeUserId !== x.principalId ? `<small>Agent · paid to ${esc(nameOf(x.payeeUserId))}</small>` : ''}`,
      `<small>${esc(why(x.evidence || {}))}</small>`, `${cr(x.amountMicro)}${x.amountMicro !== x.preparedMicro ? ` <small class="pg-dim">prepared ${cr(x.preparedMicro)}</small>` : ''}`,
      `<span data-state="${x.state}">${esc(STATE[x.state])}</span>${x.decisionNote ? `<small>${esc(x.decisionNote)}</small>` : ''}`,
      m && x.state === 'prepared' ? h.btn('Approve', `data-xpay="approve" data-id="${x.id}"`, false) + h.btn('Edit', `data-xpay="edit" data-id="${x.id}"`, true) + h.btn('Skip', `data-xpay="skip" data-id="${x.id}"`, true)
        : m && x.state === 'approved' ? h.btn('Pay now', `data-xpay="retry" data-id="${x.id}"`, true) : '']));
    const agreements = S.agreements.filter((a) => a.state === 'active').map((a) => h.tr('', [`<b class="pg-name">${esc(nameOf(a.principalId))}</b>`, esc(BASIS[a.basis]),
      a.basis === 'salary_recorded' ? `${(Number(a.salary.amountMinor) / 100).toLocaleString()} ${esc(a.salary.currency)} / ${a.period}` : a.basis === 'revenue_share' ? `${(a.shareBps / 100).toFixed(2)} %` : `${cr(a.amountMicro)} credits${a.basis === 'per_accepted_task' ? ' each' : ` / ${a.period}`}`,
      `<small>since ${esc(a.startsOn)}${a.note ? ` · ${esc(a.note)}` : ''}</small>`, m ? h.btn('End', `data-xpay="end" data-id="${a.id}"`, true) : '']));
    return h.page(h.head({ title: m ? 'Pay' : 'My pay', sub: m ? 'Agreements and payouts. Payouts are prepared from the work report; a person decides each one.' : 'Your agreement and payouts in this workspace', acts }) + tabs + nav
      + `<section class="pg-sec"><h3>Payouts</h3>${rows.length ? h.table(['Member', 'From', 'Credits', 'State', ''], rows)
        : h.box('chart', ended ? 'Nothing prepared for this period' : 'This period is still running', m && ended ? 'Prepare payouts reads each agreement and work report. Nothing is paid until you approve it.' : 'Payouts are prepared once the period is over.', '', 'sm')}</section>`
      + `<section class="pg-sec"><h3>Agreements</h3>${agreements.length ? h.table(['Member', 'Basis', 'Amount', '', ''], agreements) : h.box('user', 'No pay agreements yet', m ? 'Set pay for a member to start.' : 'Nobody has set your pay in this workspace.', '', 'sm')}</section>`
      + '<p class="pg-dim xdir-note">Credits are paid from the workspace wallet (1 credit = €0.01). Salaries paid outside XENO are recorded for your payroll provider; export them as CSV. An agent’s pay goes to its owner.</p>', 'xdir');
  }

  async function setPay() {
    const opts = S.people.map((p) => [p.id, p.name, p.kind === 'agent' ? 'Agent — paid to its owner' : (p.title || '')]);
    if (!opts.length) return toast('Nobody to pay in this workspace yet');
    const v = await D().form({ title: 'Set pay', sub: 'This replaces their current agreement. Nothing is paid until you approve a payout.', submit: 'Save', size: 'sm', fields: [
      { id: 'who', label: 'Member', type: 'choice', cols: 1, required: true, options: opts },
      { id: 'basis', label: 'Basis', type: 'choice', cols: 1, required: true, value: 'per_accepted_task', options: Object.entries(BASIS).map(([k, l]) => [k, l]) },
      { id: 'amount', label: 'Credits (per period or per task) · or salary amount · or revenue share %', required: true },
      { id: 'currency', label: 'Salary currency (e.g. EUR) — salary only' },
      { id: 'period', label: 'Period', type: 'choice', value: 'month', options: [['month', 'Monthly'], ['week', 'Weekly']] },
      { id: 'starts', label: 'Starts on (YYYY-MM-DD)', required: true, value: new Date().toISOString().slice(0, 10) },
      { id: 'note', label: 'Note' }] });
    if (!v) return;
    const body = { workspaceId: ws(), principalId: v.who, basis: v.basis, period: v.period, startsOn: v.starts, note: v.note || undefined };
    if (v.basis === 'salary_recorded') body.salary = { amountMinor: String(Math.round(Number(String(v.amount).replace(',', '.')) * 100)), currency: String(v.currency || '').toUpperCase() };
    else if (v.basis === 'revenue_share') body.shareBps = Math.round(Number(String(v.amount).replace(',', '.')) * 100);
    else body.amountMicro = toMicro(v.amount);
    const r = await api('POST', '/api/compensation/agreements', body);
    if (!r.ok) return toast(`Not saved (${r.d.error || 'try again'})`);
    toast('Pay set'); S.key = null; paint();
  }
  async function decide(id, decision, amountMicro) {
    const x = S.payouts.find((p) => p.id === id); if (!x) return;
    if (decision === 'approve' && !await D().confirm?.({ title: `Pay ${cr(amountMicro ?? x.amountMicro)} credits to ${nameOf(x.payeeUserId)}?`, body: 'Credits move from the workspace wallet now. This cannot be undone here.', action: 'Approve and pay' })) return;
    const r = await api('POST', `/api/compensation/payouts/${id}/decide`, { workspaceId: ws(), decision, ...(amountMicro ? { amountMicro } : {}) });
    if (!r.ok) return toast(r.status === 402 ? 'Approved, but the workspace wallet does not hold enough credits yet — add credits, then Pay now' : `Not done (${r.d.error || 'try again'})`);
    toast(decision === 'skip' ? 'Skipped' : 'Paid'); S.key = null; paint();
  }
  async function edit(id) {
    const x = S.payouts.find((p) => p.id === id); if (!x) return;
    const v = await D().form({ title: 'Approve another amount', sub: `Prepared: ${cr(x.preparedMicro)} credits. Both stay on the record.`, submit: 'Next', size: 'sm', fields: [{ id: 'amount', label: 'Credits', required: true, value: cr(x.amountMicro) }] });
    if (!v) return;
    const m = toMicro(v.amount); if (!m || m === '00000') return toast('Enter an amount above zero, or skip it');
    return decide(id, 'approve', m);
  }

  function route(it) {
    const m = String(it || '').match(/^Directory\/pay(?:\/(\d{4}-\d{2}-\d{2})\/(week|month))?$/);
    if (!m) return null;
    const h = H(), start = m[1] || lastMonth(), period = m[2] || 'month';
    if (S.key !== 'pay') { S.key = 'pay'; S.status = 'loading'; setTimeout(load, 0); }
    if (S.status === 'loading') return h.page('<div class="xdv-skel" aria-busy="true"><i></i><i></i><i></i></div>', 'xdir');
    if (S.status === 'nows') return h.page(h.box('user', 'Open a workspace first', 'Pay belongs to a workspace.'), 'xdir');
    if (S.status === 'none') return h.page(h.head({ title: 'Pay' }) + h.box('lock', 'Pay is not available here', 'It is for members of a workspace.'), 'xdir');
    if (S.status === 'error') return h.page(h.box('alert', 'Pay could not be loaded just now', 'Nothing changed. Try again.'), 'xdir');
    return page(start, period);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-xpay]'); if (!b || !b.closest('#main')) return;
    e.preventDefault();
    const a = b.dataset.xpay;
    if (a === 'set') return setPay();
    if (a === 'approve') return decide(b.dataset.id, 'approve');
    if (a === 'retry') return decide(b.dataset.id, 'approve');
    if (a === 'skip') return decide(b.dataset.id, 'skip');
    if (a === 'edit') return edit(b.dataset.id);
    if (a === 'end') return (async () => { const r = await api('POST', `/api/compensation/agreements/${b.dataset.id}/end`, { workspaceId: ws() }); toast(r.ok ? 'Agreement ended' : 'Not ended'); S.key = null; paint(); })();
    if (a === 'prepare') return (async () => {
      const r = await api('POST', '/api/compensation/payouts/prepare', { workspaceId: ws(), periodStart: b.dataset.s, period: b.dataset.p });
      toast(r.ok ? `${r.d.prepared.length} payout${r.d.prepared.length === 1 ? '' : 's'} prepared${r.d.existing.length ? `, ${r.d.existing.length} already there` : ''}` : `Not prepared (${r.d.error || 'try again'})`);
      S.key = null; paint();
    })();
  });
  // breadcrumb words for Directory/pay/<start>/<period>
  window.XENO_PAY = { served: true, route, label: (start, period) => (/^\d{4}-\d{2}-\d{2}$/.test(start) ? label(start, period === 'week' ? 'week' : 'month') : start) };
})();
