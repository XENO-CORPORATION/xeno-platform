/* XENO_FUND — project funding (XENO-WORKFORCE-01 §8.7). A project pool is a restricted share of the ledger (FUND-01),
 * funded only by paid credit lots (FUND-02), gated by milestones (FUND-14), with separate rights to contribute, plan,
 * approve, spend and refund (FUND-13), no fee on contributing (FUND-15), unspent value returning to its origin
 * (FUND-10/16), version-bound terms (FUND-18) and a contributor view of confirmed / committed / consumed / returned /
 * disputed (FUND-12). A pending contribution is shown as pending — never as failed because it is slow (FUND-05).
 * Platform: /api/v2/projects/:id/funding {campaign, milestones, contributions, capabilities}
 */
(() => {
  const X = () => window.XW, D = () => window.XD, P = () => window.XENO_PAGES.h, WF = () => window.XENO_WF;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ic = (k) => X().ic(k), now = () => Date.now(), DAY = 864e5, rid = () => now().toString(36) + Math.random().toString(36).slice(2, 5);
  const cr = (n) => `${Math.round(n).toLocaleString('en')} cr`;
  const LS = { get(k, d) { try { const v = localStorage.getItem('xw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('xw.' + k, JSON.stringify(v)); } catch {} } };
  const CAPS = [['contribute', 'Contribute'], ['plan', 'Plan budgets'], ['approve', 'Approve budgets'], ['spend', 'Spend'], ['refund', 'Refund']];
  const you = () => WF()?.you() || 'Emilian';
  // the account's credit lots: only paid lots are eligible (FUND-02); promotional credit is shown, never counted
  const lots = () => LS.get('lots', [{ id: 'lot1', kind: 'paid', amount: 1800, from: 'Pro plan top-up' }, { id: 'lot2', kind: 'paid', amount: 600, from: 'Credit pack' }, { id: 'lot3', kind: 'promo', amount: 500, from: 'Welcome credit' }]);
  const eligible = () => lots().filter((l) => l.kind === 'paid').reduce((n, l) => n + l.amount, 0);

  function seed(name) {
    const t0 = now(), base = { campaign: 'open', terms: 1, milestones: [], contribs: [], caps: {}, spent: 0 };
    if (name === 'Brand refresh') {
      base.milestones = [
        { id: 'm1', title: 'Identity system', threshold: 1200, budget: 1500, approved: true, plannedBy: 'Mira', criteria: 'Logo, type and colour tokens approved by the brand owner', state: 'done', evidence: 'Brand guidelines.pdf — approved by Emilian', terms: 1, spent: 1180, reserved: 0 },
        { id: 'm2', title: 'Homepage and product pages', threshold: 1600, budget: 2200, approved: true, plannedBy: 'Mira', criteria: 'Homepage hero live, three product pages shipped', state: 'active', evidence: '', terms: 1, spent: 640, reserved: 300 },
        { id: 'm3', title: 'Launch film', threshold: 2400, budget: 3000, approved: false, plannedBy: 'Mira', criteria: '90-second film, cut for web and social', state: 'locked', evidence: '', terms: 1, spent: 0, reserved: 0 }];
      base.contribs = [
        { id: 'c1', who: 'Emilian', amount: 1500, milestone: 'm1', state: 'confirmed', at: t0 - 30 * DAY, terms: 1, lot: 'Pro plan top-up' },
        { id: 'c2', who: 'Mira', amount: 1200, milestone: null, state: 'confirmed', at: t0 - 20 * DAY, terms: 1, lot: 'Credit pack' },
        { id: 'c3', who: 'Nova', amount: 900, milestone: 'm2', state: 'confirmed', at: t0 - 9 * DAY, terms: 1, lot: 'Credit pack' },
        { id: 'c4', who: 'Lumen Studio', amount: 400, milestone: 'm3', state: 'disputed', at: t0 - 5 * DAY, terms: 1, lot: 'Card purchase — chargeback opened' }];
      base.caps = { Emilian: ['contribute', 'approve', 'refund'], Mira: ['contribute', 'plan', 'spend'], Nova: ['contribute'], Atlas: ['spend'] };
    } else base.caps = { [you()]: ['contribute', 'plan', 'approve', 'spend', 'refund'] };
    return base;
  }
  const all = () => LS.get('funding', {});
  const F = (name) => { const a = all(); if (!a[name]) { a[name] = seed(name); LS.set('funding', a); } return a[name]; };
  const save = (name, f, msg) => { const a = all(); a[name] = f; LS.set('funding', a); X().render(); if (msg) X().toast(msg); };
  const has = (f, who, cap) => (f.caps[who] || []).includes(cap);

  // the money, derived — never a stored balance (FUND-01)
  function sums(f) {
    const conf = f.contribs.filter((c) => c.state === 'confirmed'), committed = f.milestones.reduce((n, m) => n + m.reserved, 0), consumed = f.milestones.reduce((n, m) => n + m.spent, 0);
    const funded = (m) => conf.filter((c) => c.milestone === m.id).reduce((n, c) => n + c.amount, 0);
    const general = conf.filter((c) => !c.milestone).reduce((n, c) => n + c.amount, 0);
    return { confirmed: conf.reduce((n, c) => n + c.amount, 0), committed, consumed, returned: f.contribs.filter((c) => c.state === 'returned').reduce((n, c) => n + c.amount, 0), disputed: f.contribs.filter((c) => c.state === 'disputed').reduce((n, c) => n + c.amount, 0), pending: f.contribs.filter((c) => c.state === 'pending').reduce((n, c) => n + c.amount, 0), funded, general };
  }
  // general (unrestricted) money is shared out to milestones in order — restricted money never moves to another milestone
  function available(f, m) { const s = sums(f); let pool = s.general; for (const x of f.milestones) { const need = Math.max(0, x.threshold - s.funded(x)); const take = Math.min(pool, need); if (x.id === m.id) return s.funded(x) + take; pool -= take; } return s.funded(m); }

  function tab(name) {
    const h = P(), f = F(name), s = sums(f), me = you(), mine = f.contribs.filter((c) => c.who === me);
    const stale = f.contribs.filter((c) => c.state === 'confirmed' && c.terms < f.terms);
    const card = (k, v, sub, cls = '') => `<div class="fd-sum ${cls}"><small>${k}</small><b>${cr(v)}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
    const ms = f.milestones.map((m, i) => {
      const got = available(f, m), pct = Math.min(100, (got / m.threshold) * 100), met = got >= m.threshold, canRun = met && m.approved, lefty = Math.max(0, m.budget - m.spent - m.reserved);
      const status = m.state === 'done' ? ['Done', 'Evidence approved'] : m.state === 'active' ? ['Running', `${cr(lefty)} of its budget left`] : !met ? ['Locked', `${cr(m.threshold - got)} more to unlock`] : !m.approved ? ['Funded', 'Waiting for its budget to be approved'] : ['Ready', 'Can start'];
      const acts = [m.state !== 'done' && has(f, me, 'contribute') && f.campaign === 'open' ? h.btn('Fund this', `data-fd="contribute" data-arg="${esc(name)}|${m.id}"`, true, 'plus') : '',
        m.state === 'locked' && met && !m.approved ? (has(f, me, 'approve') && m.plannedBy !== me ? h.btn('Approve budget', `data-fd="approve" data-arg="${esc(name)}|${m.id}"`, false, 'check') : `<span class="pg-dim fd-why">${m.plannedBy === me ? 'You planned it — someone else approves' : 'Needs someone who can approve budgets'}</span>`) : '',
        m.state === 'locked' && canRun ? h.btn('Start', `data-fd="start" data-arg="${esc(name)}|${m.id}"`, false, 'play') : '',
        m.state === 'active' && has(f, me, 'approve') ? h.btn('Accept evidence', `data-fd="done" data-arg="${esc(name)}|${m.id}"`, true, 'check') : '',
        has(f, me, 'plan') && m.state !== 'done' ? h.btn('Edit', `data-fd="editMs" data-arg="${esc(name)}|${m.id}"`, true, 'edit') : ''].join('');
      return `<li class="fd-ms fd-ms--${m.state}"><span class="fd-n">${i + 1}</span><div class="fd-body"><div class="fd-top"><b>${esc(m.title)}</b>${h.chip(status[0])}<span class="set-tag">Terms v${m.terms}</span></div>
        <p>${esc(m.criteria)}</p>
        <div class="fd-meter" title="${cr(got)} of ${cr(m.threshold)} needed"><i style="width:${pct}%"></i><em style="left:100%"></em></div>
        <div class="fd-facts"><span>${cr(got)} of ${cr(m.threshold)} to start</span><span>Budget ${cr(m.budget)}${m.approved ? '' : ' — not approved'}</span>${m.spent || m.reserved ? `<span>${cr(m.spent)} spent · ${cr(m.reserved)} committed</span>` : ''}<span class="pg-dim">${status[1]}</span></div>
        ${m.evidence ? `<p class="fd-ev">${ic('check')}${esc(m.evidence)}</p>` : ''}<div class="fd-acts">${acts}</div></div></li>`; }).join('');
    const capRows = Object.entries(f.caps).map(([who, cs]) => `<tr><th>${esc(who)}${who === me ? ' <small>(you)</small>' : ''}</th>${CAPS.map(([k]) => `<td><button class="fd-cap" role="switch" aria-checked="${cs.includes(k)}" data-fd="cap" data-arg="${esc(name)}|${esc(who)}|${k}" aria-label="${esc(who)}: ${k}">${cs.includes(k) ? ic('check') : ''}</button></td>`).join('')}</tr>`).join('');
    return `<div class="fd">
      <div class="fd-head"><div><b>Campaign ${f.campaign === 'open' ? 'open' : f.campaign}</b><small>Contributions are paid XENO credits, held for this project only. No fee. Contributing gives no membership, ownership or say over models.</small></div>
        <div class="fd-head-acts">${f.campaign === 'open' && has(f, me, 'contribute') ? h.btn('Contribute', `data-fd="contribute" data-arg="${esc(name)}|"`, false, 'plus') : ''}${has(f, me, 'plan') || has(f, me, 'approve') ? h.btn(f.campaign === 'open' ? 'Pause' : 'Reopen', `data-fd="campaign" data-arg="${esc(name)}"`, true, f.campaign === 'open' ? 'minus' : 'play') : ''}${has(f, me, 'plan') ? h.btn('Add milestone', `data-fd="addMs" data-arg="${esc(name)}"`, true, 'plus') : ''}</div></div>
      ${stale.length ? `<p class="wf-warn">${stale.length} contribution${stale.length > 1 ? 's were' : ' was'} made under older terms. They stay bound to those terms until each contributor agrees to the new ones (FUND-18).</p>` : ''}
      <div class="fd-sums">${card('Confirmed', s.confirmed, s.pending ? `${cr(s.pending)} pending` : '')}${card('Committed', s.committed, 'Held for running work')}${card('Consumed', s.consumed, 'Measured spend')}${card('Returned', s.returned)}${card('Disputed', s.disputed, s.disputed ? 'Held apart until resolved' : '', s.disputed ? 'bad' : '')}</div>
      <section class="pg-sec"><h3>Milestones</h3><ol class="fd-mss">${ms || '<li class="pg-dim">No milestones yet. Work starts per milestone, once it is funded and its budget is approved.</li>'}</ol></section>
      ${mine.length ? `<section class="pg-sec"><h3>Your contributions</h3><ul class="fd-mine">${mine.map((c) => `<li><span><b>${cr(c.amount)}</b> ${c.milestone ? 'for ' + esc(f.milestones.find((m) => m.id === c.milestone)?.title || '') : 'for the project'}<small>${esc(c.lot)} · ${new Date(c.at).toLocaleDateString()} · terms v${c.terms}</small></span>${P().chip({ confirmed: 'Confirmed', pending: 'Pending', returned: 'Returned', return_pending: 'Returning', disputed: 'Disputed' }[c.state])}${c.state === 'confirmed' ? P().btn('Return unspent', `data-fd="return" data-arg="${esc(name)}|${c.id}"`, true) : ''}${c.state === 'confirmed' && c.terms < f.terms ? P().btn('Agree to new terms', `data-fd="consent" data-arg="${esc(name)}|${c.id}"`, true) : ''}</li>`).join('')}</ul></section>` : ''}
      <section class="pg-sec"><h3>Who can do what</h3><table class="fd-caps"><thead><tr><th></th>${CAPS.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${capRows}</tbody></table>
        <p class="pg-dim wf-note">Five separate rights. Whoever plans a budget can’t approve it, and nobody can grant themselves a right they don’t have (FUND-13).</p>${has(f, me, 'approve') ? P().btn('Give someone a right', `data-fd="grant" data-arg="${esc(name)}"`, true, 'plus') : ''}</section>
    </div>`;
  }

  const ACT = {
    async contribute(arg) { const [name, mid] = arg.split('|'), f = F(name), el = eligible(), promo = lots().filter((l) => l.kind !== 'paid').reduce((n, l) => n + l.amount, 0);
      const opts = [['', 'The whole project', 'Goes where it’s needed first'], ...f.milestones.filter((m) => m.state !== 'done').map((m) => [m.id, m.title, `${cr(Math.max(0, m.threshold - available(f, m)))} to unlock`])];
      const v = await D().form({ title: `Contribute to ${name}`, sub: `Terms v${f.terms} · beneficiary: ${name} · no fee`, submit: 'Contribute',
        aside: `<b class="xd-sum-h">Before you confirm</b><ul class="xd-caps"><li>${cr(el)} of your credits can be used — paid credits only${promo ? `; ${cr(promo)} of welcome credit can’t` : ''}</li><li>It’s held for this project and can’t be spent on anything else</li><li>Whatever isn’t spent or committed can be returned to you, as the same credits</li><li>It gives you no membership, ownership or say over which models run</li></ul>`,
        fields: [{ id: 'n', label: 'Credits', type: 'number', required: true, value: '500', validate: (x) => (!/^\d+$/.test(x) || +x <= 0 ? 'A whole number.' : +x > el ? `You can use up to ${cr(el)}.` : null) }, { id: 'm', label: 'For', type: 'choice', cols: 1, value: mid || '', options: opts }] });
      if (!v) return; const c = { id: 'c' + rid(), who: you(), amount: +v.n, milestone: v.m || null, state: 'pending', at: now(), terms: f.terms, lot: 'Paid credits' };
      f.contribs.unshift(c); spendLots(+v.n); save(name, f, 'Contribution sent — confirming…');
      setTimeout(() => { const f2 = F(name), c2 = f2.contribs.find((x) => x.id === c.id); if (c2 && c2.state === 'pending') { c2.state = 'confirmed'; save(name, f2, `${cr(c.amount)} confirmed for ${name}`); } }, 1500); },
    async return(arg) { const [name, cid] = arg.split('|'), f = F(name), c = f.contribs.find((x) => x.id === cid), m = c.milestone && f.milestones.find((x) => x.id === c.milestone);
      const used = m ? Math.min(c.amount, m.spent + m.reserved) : 0, back = Math.max(0, c.amount - used);
      if (!back) return D().confirm({ title: 'Nothing to return', body: 'All of it has been spent or is committed to running work. Spent credits aren’t refundable by withdrawing.', action: 'OK', danger: false });
      if (!await D().confirm({ title: `Return ${cr(back)}?`, body: `${used ? `${cr(used)} is already spent or committed and stays. ` : ''}${cr(back)} goes back to your balance as the same paid credits. No fee.`, action: `Return ${cr(back)}`, danger: false })) return;
      c.state = 'return_pending'; save(name, f, 'Returning…'); setTimeout(() => { const f2 = F(name), c2 = f2.contribs.find((x) => x.id === cid); c2.state = 'returned'; if (back < c2.amount) { f2.contribs.push({ ...c2, id: 'c' + rid(), amount: c2.amount - back, state: 'confirmed', lot: c2.lot + ' (kept for spent work)' }); c2.amount = back; } refundLots(back); save(name, f2, `${cr(back)} returned to your balance`); }, 1200); },
    consent(arg) { const [name, cid] = arg.split('|'), f = F(name), c = f.contribs.find((x) => x.id === cid); c.terms = f.terms; save(name, f, `Agreed to terms v${f.terms}`); },
    approve(arg) { const [name, mid] = arg.split('|'), f = F(name), m = f.milestones.find((x) => x.id === mid); if (m.plannedBy === you()) return X().toast('You planned this budget — someone else approves it'); m.approved = true; WF()?.decide({ kind: 'budget', subject: name, what: `Approved ${cr(m.budget)} for “${m.title}”` }); window.XENO_WF?.persist(); save(name, f, 'Budget approved'); },
    start(arg) { const [name, mid] = arg.split('|'), f = F(name), m = f.milestones.find((x) => x.id === mid); if (available(f, m) < m.threshold || !m.approved) return X().toast('Not funded or not approved yet'); m.state = 'active'; m.reserved = Math.round(m.budget * 0.15); save(name, f, `“${m.title}” started — ${cr(m.reserved)} committed`); },
    async done(arg) { const [name, mid] = arg.split('|'), f = F(name), m = f.milestones.find((x) => x.id === mid); const v = await D().form({ title: `Accept “${m.title}”`, sub: m.criteria, submit: 'Accept as done', size: 'sm', fields: [{ id: 'e', label: 'Evidence', required: true, placeholder: 'What shows it’s done — a file, a link, a review' }] });
      if (!v) return; m.state = 'done'; m.spent += m.reserved; m.reserved = 0; m.evidence = `${v.e} — accepted by ${you()}`; save(name, f, 'Milestone done'); },
    async addMs(name) { const f = F(name); const v = await D().form({ title: 'New milestone', sub: 'Declared before anyone funds it: what it needs to start, what it may spend, and how it’s judged done.', submit: 'Add milestone', fields: [{ id: 't', label: 'Title', required: true, max: 60 }, { id: 'th', label: 'Credits needed to start', type: 'number', required: true, value: '1000' }, { id: 'b', label: 'Most it may spend', type: 'number', required: true, value: '1500', validate: (x, a) => (+x < +a.th ? 'At least the amount needed to start.' : null) }, { id: 'c', label: 'Done when', type: 'textarea', rows: 2, required: true }] });
      if (!v) return; f.milestones.push({ id: 'm' + rid(), title: v.t, threshold: +v.th, budget: +v.b, approved: false, plannedBy: you(), criteria: v.c, state: 'locked', evidence: '', terms: f.terms, spent: 0, reserved: 0 }); save(name, f, 'Milestone added — it needs someone else to approve its budget'); },
    async editMs(arg) { const [name, mid] = arg.split('|'), f = F(name), m = f.milestones.find((x) => x.id === mid), funded = f.contribs.some((c) => c.milestone === mid || !c.milestone);
      const v = await D().form({ title: `Edit “${m.title}”`, sub: funded ? 'People have already funded this. Changing its terms makes a new version; their contributions keep the old terms until they agree.' : '', submit: 'Save', fields: [{ id: 'b', label: 'Most it may spend', type: 'number', required: true, value: String(m.budget) }, { id: 'c', label: 'Done when', type: 'textarea', rows: 2, required: true, value: m.criteria }] });
      if (!v || (+v.b === m.budget && v.c === m.criteria)) return; m.budget = +v.b; m.criteria = v.c; m.approved = false; m.plannedBy = you(); if (funded) { f.terms += 1; m.terms = f.terms; } save(name, f, funded ? `Terms are now v${f.terms} — the budget needs approving again` : 'Saved'); },
    campaign(name) { const f = F(name); f.campaign = f.campaign === 'open' ? 'paused' : 'open'; save(name, f, f.campaign === 'paused' ? 'Paused — no new contributions; running work continues' : 'Campaign reopened'); },
    cap(arg) { const [name, who, k] = arg.split('|'), f = F(name), me = you(); if (!has(f, me, 'approve')) return X().toast('Only someone who approves budgets changes rights');
      const on = (f.caps[who] || []).includes(k); if (who === me && !on) return X().toast('You can’t grant yourself a right — ask another approver');
      if (who === me && k === 'approve' && on && !Object.entries(f.caps).some(([w, cs]) => w !== me && cs.includes('approve'))) return X().toast('Someone else must be able to approve first');
      f.caps[who] = on ? f.caps[who].filter((x) => x !== k) : [...(f.caps[who] || []), k]; WF()?.decide({ kind: 'role', subject: who, what: `${who}: ${on ? 'no longer' : 'can now'} ${k} on ${name}` }); window.XENO_WF?.persist(); save(name, f); },
    async grant(name) { const f = F(name), ppl = (window.XENO_PG_WORKSPACE.members || []).filter((m) => m.status !== 'departed' && !f.caps[m.name]);
      if (!ppl.length) return X().toast('Everyone already has a row'); const v = await D().form({ title: 'Give someone a right', submit: 'Give', size: 'sm', fields: [{ id: 'w', label: 'Who', type: 'choice', cols: 2, required: true, options: ppl.map((m) => [m.name, m.name, m.kind === 'agent' ? 'Agent' : m.title]) }, { id: 'k', label: 'Right', type: 'seg', value: 'contribute', options: CAPS }] });
      if (!v) return; f.caps[v.w] = [v.k]; save(name, f, `${v.w} can ${v.k}`); },
  };
  function spendLots(n) { const L = lots(); for (const l of L) { if (l.kind !== 'paid' || !n) continue; const t = Math.min(l.amount, n); l.amount -= t; n -= t; } LS.set('lots', L); }
  function refundLots(n) { const L = lots(); const l = L.find((x) => x.kind === 'paid'); l.amount += n; LS.set('lots', L); }
  document.addEventListener('click', (e) => { const t = e.target.closest('[data-fd]'); if (!t || t.closest('.xd')) return; e.preventDefault(); e.stopPropagation(); ACT[t.dataset.fd]?.(t.dataset.arg); }, true);
  window.XENO_FUND = { tab, F, sums };
})();
