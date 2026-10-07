/* XENO_COMPANY — a company is a workspace with a legal entity, a wallet, seats and staff (xeno-company/SPEC §1, §4.1, §4.2).
 *   §4.1 a company IS a workspace (workspace_type='company'), never a second tenancy · members are one model, kind human|agent
 *   §4.2 the legal layer: registrations are 1..N (primary + branches), and the four identifier namespaces — registry, tax,
 *        customs, financial-market — are separate lists; one is never computed from another; VAT prefixes are their own
 *        list (EL, not GR; XI for Northern Ireland)
 *   §1.4 the wallet is a scope on the existing credits ledger: top-ups in, spend out by division and agent, Marketplace
 *        earnings in; a division budget is an allocation from it (DIV-07)
 *   §1.2 employing an agent is an admission plus a title (WORKFORCE LIFE-01); the Mind and its Soul stay with whoever owns
 *        them — employing never moves them
 * Platform: /api/v2/companies/:id · /registrations · /identifiers · /wallet · /seats ; employment = /workspaces/:id/memberships
 */
(() => {
  const X = () => window.XW, D = () => window.XD, P = () => window.XENO_PAGES.h, WF = () => window.XENO_WF, Wd = () => window.XENO_PG_WORKSPACE;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ic = (k) => X().ic(k), now = () => Date.now(), DAY = 864e5, rid = () => now().toString(36) + Math.random().toString(36).slice(2, 5);
  const LS = { get(k, d) { try { const v = localStorage.getItem('xw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('xw.' + k, JSON.stringify(v)); } catch {} } };
  const cur = () => window.XA.currentWorkspace(), cr = (n) => `${Math.round(n).toLocaleString('en')} cr`, day = (t) => new Date(t).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
  const isCompany = (w) => w.id !== 'personal' && !/Guest/.test(w.sub || '');
  const isOwner = (w) => (w.id === 'xeno' || /owner/i.test(w.sub || '')) && (!window.XENO_ROLE || window.XENO_ROLE.can('manage'));
  const JUR = [['AE-DXB', 'United Arab Emirates — Dubai (DIFC)', 'DIFC Registrar of Companies'], ['RO', 'Romania', 'ONRC — Trade Register'], ['DE', 'Germany', 'Handelsregister (court)'], ['FR', 'France', 'RCS / SIREN'], ['GR', 'Greece', 'GEMI'], ['GB-NIR', 'United Kingdom — Northern Ireland', 'Companies House'], ['US-DE', 'United States — Delaware', 'Division of Corporations']];
  // §4.2 rule 5: VAT prefixes are their own list, NOT ISO 3166 — Greece is EL, Northern Ireland is XI
  const VAT = { RO: 'RO', DE: 'DE', FR: 'FR', GR: 'EL', 'GB-NIR': 'XI' };
  const jur = (k) => JUR.find((j) => j[0] === k);

  function co(w = cur()) {
    const A = LS.get('company', {});
    if (!A[w.id]) {
      A[w.id] = w.id === 'xeno'
        ? { name: 'XENO Corp', form: 'FZ-LLC', registrations: [{ id: 'r1', jur: 'AE-DXB', register: 'DIFC Registrar of Companies', number: '0042117', role: 'primary', at: now() - 200 * DAY }, { id: 'r2', jur: 'RO', register: 'ONRC — Trade Register', number: 'J40/11284/2026', role: 'branch', at: now() - 60 * DAY }],
          ids: { tax: [{ id: 't1', scheme: 'VAT', prefix: 'RO', number: '49120338', jur: 'RO' }], customs: [{ id: 'c1', scheme: 'EORI', number: 'RO49120338', jur: 'RO' }], fin: [] },
          wallet: { ledger: [{ at: now() - 30 * DAY, what: 'Top-up', amt: 20000, kind: 'in' }, { at: now() - 20 * DAY, what: 'Agent runs — Atlas', amt: -2400, kind: 'out', scope: 'Atlas' }, { at: now() - 12 * DAY, what: 'Marketplace earnings — Launch copy Mind', amt: 3100, kind: 'in' }, { at: now() - 9 * DAY, what: 'Agent runs — Kit', amt: -1850, kind: 'out', scope: 'Kit' }, { at: now() - 4 * DAY, what: 'Pixel — image generation', amt: -920, kind: 'out', scope: 'Pixel' }, { at: now() - DAY, what: 'Agent runs — Juno', amt: -640, kind: 'out', scope: 'Juno' }] },
          seats: { plan: 'Team', humans: 15 } }
        : { name: w.name, form: '', registrations: [], ids: { tax: [], customs: [], fin: [] }, wallet: { ledger: [] }, seats: { plan: 'Team', humans: 5 }, fresh: true };
      LS.set('company', A);
    }
    return A[w.id];
  }
  const saveCo = (c, w = cur()) => { const A = LS.get('company', {}); A[w.id] = c; LS.set('company', A); };
  const balance = (c) => c.wallet.ledger.reduce((n, e) => n + e.amt, 0);
  const allocated = () => (WF()?.divs() || []).reduce((n, d) => n + (d.budget?.alloc || 0), 0);

  function page() {
    const h = P(), w = cur();
    if (!isCompany(w)) return h.page(h.head({ eyebrow: '<a data-go="workspace">Workspace</a>', title: 'Company', sub: `${w.name} is ${w.id === 'personal' ? 'your personal space' : 'a workspace you are a guest in'}.` }) + h.box('building', w.id === 'personal' ? 'This is your personal space' : 'Only its owners manage the company', w.id === 'personal' ? 'Create a company to share a wallet, hire people, employ agents and sell on the Marketplace as a business.' : 'You can see your own seat and what you were given access to.', w.id === 'personal' ? h.btn('Create a company', 'data-xa="newCompany"', false, 'plus') : '') + h.foot('workspace', 'GET /api/v2/companies/:id'));
    const money = !window.XENO_ROLE || window.XENO_ROLE.can('manage');
    const c = co(w), bal = balance(c), staff = Wd().members.filter((m) => m.kind === 'agent' && m.status !== 'departed'), ppl = Wd().members.filter((m) => m.kind === 'human' && m.status !== 'departed');
    const steps = [['Register the legal entity', c.registrations.length > 0, 'data-co="addReg"'], ['Fund the wallet', bal > 0, 'data-co="topup"'], ['Invite people', ppl.length > 1, 'data-xa="invite"'], ['Employ an agent', staff.length > 0, 'data-co="employ"']];
    const spend = {}; c.wallet.ledger.filter((e) => e.kind === 'out').forEach((e) => { spend[e.scope || 'Other'] = (spend[e.scope || 'Other'] || 0) - e.amt; }); const maxS = Math.max(1, ...Object.values(spend));
    const idList = (k, label, add) => `<div class="co-ids"><div class="mk-row"><b>${label}</b>${isOwner(w) ? h.btn('Add', `data-co="addId" data-arg="${k}"`, true, 'plus') : ''}</div>${c.ids[k].length ? `<ul class="mk-rcl">${c.ids[k].map((x) => `<li><span>${esc(x.scheme)}</span><span>${esc((x.prefix || '') + x.number)} · ${esc(jur(x.jur)?.[1] || x.jur)}</span>${isOwner(w) ? `<button class="pg-link" data-co="rmId" data-arg="${k}|${x.id}">Remove</button>` : '<b></b>'}</li>`).join('')}</ul>` : `<p class="pg-dim">${add}</p>`}</div>`;
    return h.page(h.head({ eyebrow: '<a data-go="workspace">Workspace</a>', title: c.name, sub: `${c.form ? c.form + ' · ' : ''}${c.registrations.length ? jur(c.registrations.find((r) => r.role === 'primary')?.jur || c.registrations[0].jur)?.[1] : 'Not registered yet'} · ${ppl.length} people · ${staff.length} agents`, acts: isOwner(w) ? h.btn('Edit details', 'data-co="edit"', true, 'edit') : '' })
      + (isOwner(w) && steps.some((s) => !s[1]) ? `<section class="co-start"><b>Set up ${esc(c.name)}</b><ol>${steps.map(([t, d, a]) => `<li class="${d ? 'done' : ''}">${ic(d ? 'check' : 'plus')}${d ? `<span>${t}</span>` : `<button class="pg-link" ${a}>${t}</button>`}</li>`).join('')}</ol></section>` : '')
      + `${money ? `<div class="fd-sums mk-4"><div class="fd-sum"><small>Wallet</small><b>${cr(bal)}</b><span>${cr(allocated())} allocated to divisions</span></div><div class="fd-sum"><small>Spent this month</small><b>${cr(Object.values(spend).reduce((n, v) => n + v, 0))}</b></div><div class="fd-sum"><small>Earned on Marketplace</small><b>${cr(c.wallet.ledger.filter((e) => /Marketplace/.test(e.what)).reduce((n, e) => n + e.amt, 0))}</b></div><div class="fd-sum"><small>Seats</small><b>${ppl.length} of ${c.seats.humans}</b><span>${c.seats.plan} plan · agents don’t take seats</span></div></div>` : `<p class="cm-banner">${ic('lock')}<span>The wallet, its ledger and the company’s identifiers are visible to owners and admins.</span></p>`}
      <div class="mk-cols"><div>
        ${money ? `<section class="pg-sec"><div class="mk-row"><h3>Wallet</h3>${isOwner(w) ? h.btn('Add credits', 'data-co="topup"', true, 'plus') + h.btn('Allocate to a division', 'data-co="allocate"', true) : ''}</div>
          ${Object.keys(spend).length ? `<ul class="co-bars">${Object.entries(spend).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<li><span>${esc(k)}</span><i style="width:${(v / maxS) * 100}%"></i><b>${cr(v)}</b></li>`).join('')}</ul>` : '<p class="pg-dim">Nothing spent yet.</p>'}
          <details class="mk-rc"><summary>Every entry (${c.wallet.ledger.length})</summary><ul>${c.wallet.ledger.slice().reverse().map((e) => `<li><span>${day(e.at)}</span><span>${esc(e.what)}</span><b>${e.amt > 0 ? '+' : '−'}${cr(Math.abs(e.amt))}</b></li>`).join('')}</ul></details></section>` : ''}
        <section class="pg-sec"><div class="mk-row"><h3>Agents on staff</h3>${isOwner(w) ? h.btn('Employ an agent', 'data-co="employ"', true, 'plus') : ''}</div>
          <ul class="mk-owns">${staff.map((m) => `<li class="mk-own">${h.avatar(m)}<span class="mk-own-m"><a data-co="agent" data-arg="${esc(m.name)}"><b>${esc(m.name)}</b></a><small>${esc(m.title || 'Agent')}${m.ownedBy && m.ownedBy !== c.name ? ` · trained by ${esc(m.ownedBy)}` : ''}</small></span>${isOwner(w) ? h.btn('Change title', `data-co="title" data-arg="${esc(m.name)}"`, true) : ''}</li>`).join('') || '<li class="pg-dim">No agents on staff.</li>'}</ul>
          <p class="pg-dim wf-note">Employing an agent gives it a seat at the company and a title. Its Mind and what it has learned stay with whoever trained it.</p></section>
        <section class="pg-sec"><h3>Selling</h3><p class="mk-p">${esc(c.name)} is the seller of record for its Marketplace listings — earnings land in this wallet.</p>${h.btn('Open Seller console', 'data-go="market" data-mk="console"', true)}</section>
      </div><aside class="mk-side">
        <section class="pg-sec"><div class="mk-row"><h3>Legal entity</h3>${isOwner(w) ? h.btn('Add registration', 'data-co="addReg"', true, 'plus') : ''}</div>
          ${c.registrations.length ? `<ul class="co-regs">${c.registrations.map((r) => `<li><div class="mk-row"><b>${esc(jur(r.jur)?.[1] || r.jur)}</b>${h.chip(r.role === 'primary' ? 'Registered office' : 'Branch')}</div><small>${esc(r.register)} · ${esc(r.number)}</small></li>`).join('')}</ul>` : '<p class="pg-dim">Not registered yet. You can run the company here first and add the registration when you have it.</p>'}
          <p class="pg-dim wf-note">A company can be registered in one place and have branches in others. Each registration keeps its own number.</p></section>
        ${money ? `<section class="pg-sec"><h3>Identifiers</h3>${idList('tax', 'Tax', 'No tax numbers yet.')}${idList('customs', 'Customs', 'None.')}${idList('fin', 'Financial', 'None.')}</section>` : ''}
      </aside></div>` + h.foot('workspace', 'GET /api/v2/companies/:id'));
  }

  const done = (m) => (window.XENO_NET ? window.XENO_NET.end(() => { X().render(); if (m) X().toast(m); }) : (X().render(), m && X().toast(m), Promise.resolve(true)));
  const ACT = {
    agent(n) { X().go('global', { global: 'workspace', item: 'Agents/' + n }); },
    async edit() { const c = co(); const v = await D().form({ title: 'Company details', submit: 'Save', size: 'sm', fields: [{ id: 'n', label: 'Name', required: true, value: c.name, max: 80 }, { id: 'f', label: 'Legal form', value: c.form, placeholder: 'e.g. FZ-LLC, SRL, GmbH' }] }); if (!v) return; c.name = v.n.trim(); c.form = v.f.trim(); saveCo(c); done('Saved'); },
    async addReg() { const c = co(); const v = await D().form({ title: 'Add a registration', sub: 'Where the company — or one of its branches — is registered.', submit: 'Add', fields: [{ id: 'j', label: 'Where', type: 'choice', cols: 1, required: true, options: JUR.map((j) => [j[0], j[1], j[2]]) }, { id: 'n', label: 'Registration number', required: true, placeholder: 'Exactly as the register shows it' }, { id: 'r', label: 'This is', type: 'seg', value: c.registrations.some((r) => r.role === 'primary') ? 'branch' : 'primary', options: [['primary', 'The registered office'], ['branch', 'A branch']] }] });
      if (!v) return; if (v.r === 'primary') c.registrations.forEach((r) => { if (r.role === 'primary') r.role = 'branch'; });
      c.registrations.push({ id: 'r' + rid(), jur: v.j, register: jur(v.j)[2], number: v.n.trim(), role: v.r, at: now() }); saveCo(c); WF()?.decide({ kind: 'company', subject: c.name, what: `Added ${v.r === 'primary' ? 'registered office' : 'branch'} in ${jur(v.j)[1]}` }); WF()?.persist(); done('Registration added'); },
    async addId(k) { const c = co(); const regs = c.registrations.map((r) => r.jur);
      const v = await D().form({ title: { tax: 'Add a tax number', customs: 'Add a customs number', fin: 'Add a financial identifier' }[k], submit: 'Add', size: 'sm', fields: [{ id: 's', label: 'Kind', type: 'seg', value: { tax: 'VAT', customs: 'EORI', fin: 'LEI' }[k], options: { tax: [['VAT', 'VAT'], ['TRN', 'Tax registration']], customs: [['EORI', 'EORI']], fin: [['LEI', 'LEI']] }[k] }, { id: 'j', label: 'Country', type: 'choice', cols: 1, required: true, options: (regs.length ? JUR.filter((j) => regs.includes(j[0])) : JUR).map((j) => [j[0], j[1]]) }, { id: 'n', label: 'Number', required: true, placeholder: 'Without the country prefix' }] });
      if (!v) return; const prefix = k === 'tax' && v.s === 'VAT' ? VAT[v.j] || '' : ''; c.ids[k].push({ id: k[0] + rid(), scheme: v.s, prefix, number: v.n.replace(/\s+/g, '').replace(new RegExp('^' + prefix, 'i'), ''), jur: v.j }); saveCo(c); done(prefix ? `Added — shown as ${prefix}${v.n.replace(/\s+/g, '')}` : 'Added'); },
    rmId(arg) { const [k, id] = arg.split('|'), c = co(); c.ids[k] = c.ids[k].filter((x) => x.id !== id); saveCo(c); done('Removed'); },
    async topup() { const c = co(); const v = await D().form({ title: 'Add credits to the company wallet', sub: 'Test checkout — this prototype charges no card.', submit: 'Add credits', size: 'sm', fields: [{ id: 'a', label: 'Credits', type: 'seg', value: '10000', options: [['5000', '5,000 · €50'], ['10000', '10,000 · €100'], ['50000', '50,000 · €500']] }] }); if (!v) return; c.wallet.ledger.push({ at: now(), what: 'Top-up', amt: +v.a, kind: 'in' }); saveCo(c); done(`${cr(+v.a)} added`); },
    async allocate() { const c = co(), ds = WF()?.divs() || []; if (!ds.length) return X().toast('Create a division first — Workspace › Divisions');
      const free = balance(c) - allocated(); const v = await D().form({ title: 'Allocate to a division', sub: `${cr(free)} of the wallet isn’t allocated yet. A division can spend up to its allocation.`, submit: 'Allocate', size: 'sm', fields: [{ id: 'd', label: 'Division', type: 'choice', cols: 2, required: true, options: ds.map((d) => [d.id, d.name, cr(d.budget?.alloc || 0)]) }, { id: 'a', label: 'Credits to add', type: 'number', required: true, value: '1000', validate: (x) => (!/^\d+$/.test(x) ? 'A whole number.' : +x > free ? `Up to ${cr(free)}.` : null) }] });
      if (!v) return; const d = ds.find((x) => x.id === v.d); d.budget = { alloc: (d.budget?.alloc || 0) + +v.a, spent: d.budget?.spent || 0, reserved: d.budget?.reserved || 0 }; WF().decide({ kind: 'budget', subject: d.name, what: `Allocated ${cr(+v.a)} from the company wallet to ${d.name}` }); WF().persist(); done(`${d.name} can now spend ${cr(d.budget.alloc)}`); },
    async employ() { const c = co(), A = window.XENO_PG_ANIMA, here = new Set(Wd().members.map((m) => m.name)), cands = A.minds.filter((m) => !here.has(m.name));
      if (!cands.length) return D().confirm({ title: 'No agents to employ', body: 'Every Mind you have already works here. Create a new Mind in Anima, or rent one from the Marketplace.', action: 'Open Anima', danger: false }).then((y) => y && X().go('global', { global: 'anima' }));
      const v = await D().form({ title: 'Employ an agent', sub: `It joins ${c.name} with a title. Its Mind and Soul stay yours.`, submit: 'Employ', size: 'sm', fields: [{ id: 'm', label: 'Which Mind', type: 'choice', cols: 1, required: true, options: cands.map((m) => [m.name, m.name, m.role]) }, { id: 't', label: 'Title', required: true, placeholder: 'e.g. Research analyst' }] });
      if (!v) return; Wd().members.push({ name: v.m, kind: 'agent', title: v.t.trim(), role: 'member', status: 'active', divisions: [], ownedBy: WF().you(), lastActive: new Date().toISOString() }); WF().decide({ kind: 'admit', subject: v.m, what: `Employed ${v.m} at ${c.name} as ${v.t.trim()}` }); WF().persist(); window.XENO_DB?.save?.(); done(`${v.m} works at ${c.name} now`); },
    async title(n) { const m = Wd().members.find((x) => x.name === n); const v = await D().form({ title: `${n}’s title`, submit: 'Save', size: 'sm', fields: [{ id: 't', label: 'Title', required: true, value: m.title || '' }] }); if (!v) return; m.title = v.t.trim(); WF().decide({ kind: 'role', subject: n, what: `${n}’s title is now ${m.title}` }); WF().persist(); done('Saved'); },
  };
  document.addEventListener('click', (e) => { const t = e.target.closest('[data-co]'); if (!t || t.closest('.xd')) return; e.preventDefault(); e.stopPropagation(); window.XENO_NET?.begin('company', t.dataset.co, t); Promise.resolve(ACT[t.dataset.co]?.(t.dataset.arg)).finally(() => window.XENO_NET?.clear(t)); }, true);
  // a new company lands on its own setup page instead of a toast
  const orig = window.XA.newCompany; window.XA.newCompany = async (...a) => { const before = window.XA.workspaces().length; await orig(...a); if (window.XA.workspaces().length > before) X().go('global', { global: 'workspace', item: 'Company' }); };
  window.XENO_ROLE?.gate('co', ['topup'], 'billing', 'Only the owner adds money to the company wallet');
  window.XENO_ROLE?.gate('co', ['edit', 'addReg', 'addId', 'rmId', 'allocate', 'employ', 'title'], 'manage', 'Owners and admins manage the company');
  window.XENO_COMPANY = { route: (it) => (it === 'Company' ? page() : null), co, balance };
})();
