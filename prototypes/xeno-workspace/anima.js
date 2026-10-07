/* XENO_ANIMA — your own always-on agent (xeno-anima SPEC: "A Mind is given. A Soul is earned.").
 *   Mind = the authored seed: what it is for, its rules, the tools it may use, how much it may do alone, which model.
 *   Soul = what it earned: memories (searchable, pinnable, forgettable) and skills it taught itself (each new skill waits
 *          for you to keep or discard it; a kept skill can be switched off). The Soul is signed and checked when loaded.
 *   Always-on: it can be paused; it reaches you on channels you connect; it runs on a schedule you set.
 *   Swarm: Minds can work together — hand off, broadcast, or one leads the others.
 *   Export writes a .xanima (the Mind plus a reference to the Soul — the Soul itself is not embedded, it is large and private).
 * Platform: /api/v2/anima/minds/:id · /soul/memories · /soul/skills · /channels · /schedule · /swarms ; export = .xanima
 */
(() => {
  const X = () => window.XW, D = () => window.XD, P = () => window.XENO_PAGES.h, A = () => window.XENO_PG_ANIMA;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ic = (k) => X().ic(k), now = () => Date.now(), H = 36e5, DAY = 864e5, rid = () => now().toString(36) + Math.random().toString(36).slice(2, 5);
  const save = () => window.XENO_DB?.save?.(), day = (t) => new Date(t).toLocaleDateString('en', { day: 'numeric', month: 'short' });
  const fp = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(16).padStart(8, '0'); };
  const TOOLS = [['web', 'Search and read the web'], ['files', 'Read and write your Library'], ['mail', 'Read and draft mail'], ['code', 'Run code in a sandbox'], ['spend', 'Spend credits on paid tools']];
  const AUTO = [['ask', 'Asks before every action'], ['within', 'Acts alone inside its rules, asks for anything new'], ['act', 'Acts alone, tells you after']];
  const MODELS = [['auto', 'XENO Cloud — picks the best model per task'], ['local', 'Qwen 3.6 on this computer (XENO RT)']];
  let q = '';

  function ensure(m) {
    if (m.seed) return m;
    const purpose = { Atlas: 'Research companies, products and markets, and write cited briefs.', Juno: 'Keep my inbox at zero and file every invoice into Budget 2027.', Kit: 'Review pull requests and fix flaky tests before I see them.' }[m.name] || m.role;
    m.seed = { purpose, rules: ['Never spend more than 200 credits on one task without asking', 'Cite a source for every claim', 'Ask before contacting anyone outside the company'], tools: { web: true, files: true, mail: m.name === 'Juno', code: m.name === 'Kit', spend: false }, autonomy: 'within', model: 'auto' };
    const T = { Atlas: ['Prefers comparison tables over prose', 'Lumen Studio is a client, not a competitor', 'Q4 board memo is due Nov 3', 'Uses the brand refresh project for design questions'], Juno: ['Invoices from Acme go to Budget 2027 › Vendors', 'Dana Pierce is our legal counsel', 'Reply to investors within a day'], Kit: ['The auth tests are flaky on Windows under load', 'Emilian squashes before merging', 'CI runs on xeno-ci-win-01'] }[m.name] || [];
    m.memories = T.map((t, i) => ({ id: m.id + '_m' + i, t, at: now() - (i * 3 + 1) * DAY, pinned: i === 0, from: ['a chat', 'a run', 'a correction you made'][i % 3] }));
    m.skillList = A().skills.filter((s) => s.learnedBy === m.name).map((s, i) => ({ id: m.id + '_s' + i, name: s.name, at: Date.parse(s.at), on: true, state: 'kept', uses: 12 - i * 3 }));
    if (m.name === 'Atlas') m.skillList.unshift({ id: m.id + '_snew', name: 'Turn a pricing page into a comparison table', at: now() - 2 * H, on: false, state: 'new', uses: 1, from: 'Taught itself while comparing 14 competitor sites' });
    m.channels = { comms: true, telegram: false }; m.schedule = m.name === 'Juno' ? [{ id: 'sc1', what: 'Triage the inbox', when: 'Every weekday 08:00', on: true }] : m.name === 'Atlas' ? [{ id: 'sc2', what: 'Weekly competitor digest', when: 'Mondays 09:00', on: true }] : [];
    m.signed = { at: now() - DAY, fp: fp(m.name + 'soul') }; m.paused = false;
    return m;
  }
  const mindOf = (it) => A().minds.find((m) => it && (it === m.name || it.startsWith(m.name + ' ') || it.startsWith(m.name + '/')));
  const minds = () => A().minds.map(ensure);
  if (!A().swarms) A().swarms = [{ id: 'sw1', name: 'Launch research', members: ['Atlas', 'Juno'], pattern: 'handoff', lead: 'Atlas', note: 'Atlas researches, then hands the brief to Juno to send' }];

  // ---------- the Mind page ----------
  function mindPage(m, tab) {
    const h = P(); ensure(m); const T = [['Overview', 'Overview'], ['Mind', 'Mind'], ['Soul', 'Soul'], ['Channels', 'Channels & schedule']]; tab = T.some((t) => t[0] === tab) ? tab : 'Overview';
    const base = m.name + ' — ' + m.role.toLowerCase(), newSkills = m.skillList.filter((s) => s.state === 'new');
    const tabs = `<div class="pg-tabs" role="tablist">${T.map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" data-an="tab" data-arg="${esc(base)}|${k}">${l}${k === 'Soul' && newSkills.length ? `<em>${newSkills.length}</em>` : ''}</button>`).join('')}</div>`;
    const body = {
      Overview: () => `<div class="mk-cols"><div>
        <section class="pg-sec"><h3>Now</h3><p class="an-now">${h.chip(m.paused ? 'Paused' : m.status === 'running' ? 'Working' : 'Idle')} ${esc(m.paused ? 'Paused — nothing runs until you resume it' : m.now)}</p></section>
        ${newSkills.length ? `<section class="cm-banner">${ic('bolt')}<span><b>${m.name} taught itself something new.</b> Keep it to let it use the skill again.</span>${h.btn('Review', `data-an="tab" data-arg="${esc(base)}|Soul"`, true)}</section>` : ''}
        <section class="pg-sec"><h3>What it is for</h3><p class="mk-p">${esc(m.seed.purpose)}</p><p class="pg-dim">${esc(AUTO.find((a) => a[0] === m.seed.autonomy)[1])} · ${esc(MODELS.find((x) => x[0] === m.seed.model)[1])}</p></section>
        <section class="pg-sec"><h3>Pinned memories</h3><ul class="an-mems">${m.memories.filter((x) => x.pinned).map(memRow(m)).join('') || '<li class="pg-dim">Nothing pinned.</li>'}</ul></section>
      </div><aside class="mk-side"><section class="pg-sec pg-card-s"><h3>Soul</h3><p><b>${(m.soul.episodes + m.memories.length).toLocaleString('en')}</b><small>memories</small></p><p><b>${m.skillList.filter((s) => s.state === 'kept').length}</b><small>skills</small></p><p class="pg-dim">Signed ${day(m.signed.at)} · ${m.signed.fp}. Checked every time it loads.</p></section>
        <section class="pg-sec"><h3>Works for</h3>${worksFor(m)}</section>
        <section class="pg-sec"><div class="fd-acts">${h.btn(m.paused ? 'Resume' : 'Pause', `data-an="pause" data-arg="${m.id}"`, true, m.paused ? 'play' : 'minus')}${h.btn('Export .xanima', `data-an="export" data-arg="${m.id}"`, true, 'download')}${h.btn('Delete', `data-an="del" data-arg="${m.id}"`, true)}</div></section></aside></div>`,
      Mind: () => `<section class="pg-sec"><div class="mk-row"><h3>What it is for</h3>${h.btn('Edit', `data-an="purpose" data-arg="${m.id}"`, true, 'edit')}</div><p class="mk-p">${esc(m.seed.purpose)}</p></section>
        <section class="pg-sec"><div class="mk-row"><h3>Rules it follows</h3>${h.btn('Add a rule', `data-an="rule" data-arg="${m.id}"`, true, 'plus')}</div><ul class="an-rules">${m.seed.rules.map((r, i) => `<li><span>${esc(r)}</span><button class="pg-link" data-an="rmRule" data-arg="${m.id}|${i}">Remove</button></li>`).join('') || '<li class="pg-dim">No rules.</li>'}</ul></section>
        <section class="pg-sec"><h3>Tools it may use</h3><ul class="an-tools">${TOOLS.map(([k, l]) => `<li><span>${esc(l)}</span><button class="xd-sw" role="switch" aria-checked="${!!m.seed.tools[k]}" data-an="tool" data-arg="${m.id}|${k}" aria-label="${esc(l)}"><i></i></button></li>`).join('')}</ul><p class="pg-dim wf-note">Switching a tool off takes effect on its next step, including in work already running.</p></section>
        <section class="pg-sec"><h3>How much it does alone</h3><div class="an-seg">${AUTO.map(([k, l]) => `<button class="pg-card pg-card--div" aria-pressed="${m.seed.autonomy === k}" data-an="auto" data-arg="${m.id}|${k}"><b>${esc(l)}</b></button>`).join('')}</div></section>
        <section class="pg-sec"><h3>Model</h3><div class="an-seg">${MODELS.map(([k, l]) => `<button class="pg-card pg-card--div" aria-pressed="${m.seed.model === k}" data-an="model" data-arg="${m.id}|${k}"><b>${esc(l)}</b></button>`).join('')}</div></section>`,
      Soul: () => `${newSkills.length ? `<section class="pg-sec"><h3>New — waiting for you</h3><ul class="mk-sls">${newSkills.map((s) => `<li class="mk-sl"><b>${esc(s.name)}</b><p class="pg-dim">${esc(s.from)} · ${h.ago(new Date(s.at).toISOString())} ago</p><div class="fd-acts">${h.btn('Keep', `data-an="keep" data-arg="${m.id}|${s.id}"`, false, 'check')}${h.btn('Discard', `data-an="discard" data-arg="${m.id}|${s.id}"`, true)}</div></li>`).join('')}</ul></section>` : ''}
        <section class="pg-sec"><h3>Skills it learned</h3><ul class="an-tools">${m.skillList.filter((s) => s.state === 'kept').map((s) => `<li><span><b>${esc(s.name)}</b><small>used ${s.uses} times · learned ${day(s.at)}</small></span><button class="xd-sw" role="switch" aria-checked="${s.on}" data-an="skill" data-arg="${m.id}|${s.id}" aria-label="${esc(s.name)}"><i></i></button></li>`).join('') || '<li class="pg-dim">No skills yet. It learns them by doing work for you.</li>'}</ul></section>
        <section class="pg-sec"><div class="mk-row"><h3>What it remembers</h3><input class="an-q" type="search" placeholder="Search its memory" value="${esc(q)}" data-an-q="${m.id}" aria-label="Search its memory"></div><ul class="an-mems">${m.memories.filter((x) => !q || x.t.toLowerCase().includes(q.toLowerCase())).map(memRow(m)).join('') || `<li class="pg-dim">${q ? 'Nothing matches.' : 'It doesn’t remember anything yet.'}</li>`}</ul><p class="pg-dim wf-note">Forgetting is permanent. Its Soul is re-signed after every change.</p></section>`,
      Channels: () => `<section class="pg-sec"><h3>Where it reaches you</h3><ul class="an-tools"><li><span><b>XENO Comms</b><small>Direct messages in Comms, on every device</small></span><button class="xd-sw" role="switch" aria-checked="${m.channels.comms}" data-an="chan" data-arg="${m.id}|comms" aria-label="Comms"><i></i></button></li>
        <li><span><b>Telegram</b><small>${m.channels.telegram ? `Connected as ${esc(m.channels.telegram)}` : 'Talk to it from Telegram'}</small></span>${m.channels.telegram ? h.btn('Disconnect', `data-an="tgOff" data-arg="${m.id}"`, true) : h.btn('Connect', `data-an="tg" data-arg="${m.id}"`, true)}</li></ul></section>
        <section class="pg-sec"><div class="mk-row"><h3>Schedule</h3>${h.btn('Add', `data-an="sched" data-arg="${m.id}"`, true, 'plus')}</div><ul class="an-tools">${m.schedule.map((s) => `<li><span><b>${esc(s.what)}</b><small>${esc(s.when)}</small></span><button class="pg-link" data-an="rmSched" data-arg="${m.id}|${s.id}">Remove</button><button class="xd-sw" role="switch" aria-checked="${s.on}" data-an="schedOn" data-arg="${m.id}|${s.id}" aria-label="${esc(s.what)}"><i></i></button></li>`).join('') || '<li class="pg-dim">Nothing scheduled. It only works when you ask.</li>'}</ul></section>`,
    }[tab]();
    return h.page(h.head({ obj: true, eyebrow: '<a data-go="anima">Anima</a> · Mind', title: m.name, sub: m.role, acts: h.btn(`Chat with ${m.name}`, `data-xa="animaChat" data-arg="${esc(m.name)}"`, false, 'chat') }) + tabs + `<div class="pg-body">${body}</div>` + h.foot('anima', `GET /api/v2/anima/minds/${m.id}`));
  }
  const memRow = (m) => (x) => `<li><span>${esc(x.t)}<small>from ${esc(x.from)} · ${day(x.at)}</small></span><button class="pg-link" data-an="pin" data-arg="${m.id}|${x.id}">${x.pinned ? 'Unpin' : 'Pin'}</button><button class="pg-link" data-an="forget" data-arg="${m.id}|${x.id}">Forget</button></li>`;
  function worksFor(m) { const here = (window.XENO_PG_WORKSPACE.members || []).find((x) => x.name === m.name && x.status !== 'departed'); const lst = (window.XENO_PG_MARKET || []).find((x) => x.seller === 'You' && x.name.startsWith(m.name));
    return `<p class="mk-p">${here ? `<b>${esc(window.XA.currentWorkspace().name)}</b> — ${esc(here.title || 'agent')}` : 'Only you.'}</p>${here ? '' : P().btn('Employ at a company', 'data-co="employ"', true)}${lst ? `<p class="pg-dim">Rented out on the Marketplace — <a data-mk="open" data-arg="${lst.id}">${esc(lst.name)}</a></p>` : ''}`; }

  function swarmsPage() {
    const h = P(), S = A().swarms;
    return h.page(h.head({ eyebrow: '<a data-go="anima">Anima</a>', title: 'Swarms', sub: 'Minds that work together on one job.', acts: h.btn('New swarm', 'data-an="newSwarm"', false, 'plus') })
      + `<ul class="mk-sls">${S.map((s) => `<li class="mk-sl"><div class="mk-row"><b>${esc(s.name)}</b>${h.chip({ handoff: 'Hand off in turn', broadcast: 'All at once', orchestrate: `${s.lead} leads` }[s.pattern])}</div><p class="pg-dim">${s.members.map(esc).join(' → ')}${s.note ? ' · ' + esc(s.note) : ''}</p><div class="fd-acts">${h.btn('Run it', `data-an="runSwarm" data-arg="${s.id}"`, false, 'play')}${h.btn('Remove', `data-an="rmSwarm" data-arg="${s.id}"`, true)}</div></li>`).join('') || '<li class="pg-dim">No swarms yet.</li>'}</ul>` + h.foot('anima', 'GET /api/v2/anima/swarms'));
  }
  function memoryPage() { const h = P(); return h.page(h.head({ eyebrow: '<a data-go="anima">Anima</a> · Soul', title: 'Memory', sub: 'Everything your Minds remember, in one place.' }) + minds().map((m) => `<section class="pg-sec"><div class="mk-row"><h3>${esc(m.name)}</h3><small class="pg-dim">${m.memories.length} memories</small></div><ul class="an-mems">${m.memories.map(memRow(m)).join('') || '<li class="pg-dim">Nothing yet.</li>'}</ul></section>`).join('') + h.foot('anima', 'GET /api/v2/anima/soul/memories')); }
  function skillsPage() { const h = P(); return h.page(h.head({ eyebrow: '<a data-go="anima">Anima</a> · Soul', title: 'Skills it learned', sub: 'Skills your Minds taught themselves. New ones wait for you.' }) + minds().map((m) => `<section class="pg-sec"><div class="mk-row"><h3>${esc(m.name)}</h3></div><ul class="an-tools">${m.skillList.filter((s) => s.state !== 'discarded').map((s) => `<li><span><b>${esc(s.name)}</b><small>${s.state === 'new' ? 'New — waiting for you' : `used ${s.uses} times`}</small></span>${s.state === 'new' ? h.btn('Keep', `data-an="keep" data-arg="${m.id}|${s.id}"`, true) + h.btn('Discard', `data-an="discard" data-arg="${m.id}|${s.id}"`, true) : `<button class="xd-sw" role="switch" aria-checked="${s.on}" data-an="skill" data-arg="${m.id}|${s.id}" aria-label="${esc(s.name)}"><i></i></button>`}</li>`).join('') || '<li class="pg-dim">None yet.</li>'}</ul></section>`).join('') + h.foot('anima', 'GET /api/v2/anima/soul/skills')); }

  function route(it) {
    if (!it) return null; minds();
    if (it === 'Memory') return memoryPage();
    if (it === 'Skills it learned' || it === 'Skills') return skillsPage();
    if (it === 'Swarms') return swarmsPage();
    const m = mindOf(it); if (!m) return null; return mindPage(m, it.includes('/') ? it.split('/').pop() : 'Overview');
  }

  // ---------- actions ----------
  const M = (id) => minds().find((m) => m.id === id);
  const resign = (m) => { m.signed = { at: now(), fp: fp(m.name + JSON.stringify(m.memories) + JSON.stringify(m.skillList)) }; };
  const done = (msg) => { save(); return window.XENO_NET ? window.XENO_NET.end(() => { X().render(); if (msg) X().toast(msg); }) : (X().render(), msg && X().toast(msg), Promise.resolve(true)); };
  const ACT = {
    tab(arg) { const [base, t] = arg.split('|'); X().go('global', { global: 'anima', item: t === 'Overview' ? base : base + '/' + t }); },
    async purpose(id) { const m = M(id); const v = await D().form({ title: `What ${m.name} is for`, submit: 'Save', size: 'sm', fields: [{ id: 'p', label: 'Purpose', type: 'textarea', rows: 3, required: true, value: m.seed.purpose }] }); if (!v) return; m.seed.purpose = v.p.trim(); done('Saved — it works from this on its next step'); },
    async rule(id) { const m = M(id); const v = await D().form({ title: 'Add a rule', submit: 'Add', size: 'sm', fields: [{ id: 'r', label: 'Rule', required: true, placeholder: 'e.g. Never send mail on weekends' }] }); if (!v) return; m.seed.rules.push(v.r.trim()); done('Rule added'); },
    rmRule(arg) { const [id, i] = arg.split('|'), m = M(id); m.seed.rules.splice(+i, 1); done('Rule removed'); },
    tool(arg) { const [id, k] = arg.split('|'), m = M(id); m.seed.tools[k] = !m.seed.tools[k]; done(); },
    auto(arg) { const [id, k] = arg.split('|'); M(id).seed.autonomy = k; done(); },
    model(arg) { const [id, k] = arg.split('|'); M(id).seed.model = k; done(); },
    pin(arg) { const [id, x] = arg.split('|'), m = M(id), r = m.memories.find((y) => y.id === x); r.pinned = !r.pinned; done(); },
    async forget(arg) { const [id, x] = arg.split('|'), m = M(id), r = m.memories.find((y) => y.id === x); if (!await D().confirm({ title: 'Forget this?', body: `“${r.t}” — ${m.name} won’t remember it again. This can’t be undone.`, action: 'Forget' })) return; m.memories = m.memories.filter((y) => y.id !== x); resign(m); done('Forgotten — its Soul is re-signed'); },
    keep(arg) { const [id, x] = arg.split('|'), m = M(id), s = m.skillList.find((y) => y.id === x); s.state = 'kept'; s.on = true; resign(m); done(`${m.name} will use “${s.name}”`); },
    discard(arg) { const [id, x] = arg.split('|'), m = M(id), s = m.skillList.find((y) => y.id === x); s.state = 'discarded'; s.on = false; resign(m); done('Discarded'); },
    skill(arg) { const [id, x] = arg.split('|'), s = M(id).skillList.find((y) => y.id === x); s.on = !s.on; done(); },
    pause(id) { const m = M(id); m.paused = !m.paused; m.status = m.paused ? 'paused' : 'idle'; done(m.paused ? `${m.name} is paused — scheduled work waits` : `${m.name} is back on`); },
    chan(arg) { const [id, k] = arg.split('|'), m = M(id); m.channels[k] = !m.channels[k]; done(); },
    async tg(id) { const m = M(id), code = String(100000 + Math.floor(Math.random() * 899999));
      const v = await D().form({ title: `Connect ${m.name} to Telegram`, sub: `Open @XenoAnimaBot in Telegram and send it this code: ${code}`, submit: 'I sent it', size: 'sm', fields: [{ id: 'u', label: 'Your Telegram username', required: true, placeholder: '@you' }] });
      if (!v) return; m.channels.telegram = v.u.startsWith('@') ? v.u : '@' + v.u; done(`Connected — message ${m.name} from Telegram`); },
    tgOff(id) { M(id).channels.telegram = false; done('Disconnected from Telegram'); },
    async sched(id) { const m = M(id); const v = await D().form({ title: 'Add to the schedule', submit: 'Add', size: 'sm', fields: [{ id: 'w', label: 'What', required: true, placeholder: 'e.g. Summarise my week' }, { id: 'n', label: 'When', type: 'choice', cols: 2, required: true, value: 'Every weekday 08:00', options: [['Every weekday 08:00', 'Weekdays 08:00'], ['Mondays 09:00', 'Mondays 09:00'], ['Every day 18:00', 'Daily 18:00'], ['First of the month', 'Monthly']] }] }); if (!v) return; m.schedule.push({ id: 'sc' + rid(), what: v.w.trim(), when: v.n, on: true }); done('Scheduled'); },
    rmSched(arg) { const [id, x] = arg.split('|'), m = M(id); m.schedule = m.schedule.filter((s) => s.id !== x); done('Removed'); },
    schedOn(arg) { const [id, x] = arg.split('|'), s = M(id).schedule.find((y) => y.id === x); s.on = !s.on; done(); },
    export(id) { const m = M(id), b = new Blob([JSON.stringify({ format: 'xanima@1', mind: { name: m.name, role: m.role, ...m.seed }, soul: { ref: `soul://${m.id}`, fingerprint: m.signed.fp, embedded: false }, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${m.name}.xanima`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); X().toast(`${m.name}.xanima is downloading — its Soul stays here`); },
    async del(id) { const m = M(id); const v = await D().form({ title: `Delete ${m.name}?`, sub: 'Its Mind and its whole Soul — every memory and skill — are deleted after 30 days. Until then you can restore it.', submit: 'Delete', size: 'sm', fields: [{ id: 'n', label: `Type ${m.name} to confirm`, required: true, validate: (x) => (x.trim() === m.name ? null : `Type ${m.name}.`) }] });
      if (!v) return; A().minds = A().minds.filter((x) => x.id !== id); A().deleted = [...(A().deleted || []), { ...m, deletedAt: now() }]; save(); X().go('global', { global: 'anima' }); X().toast(`${m.name} deleted — restorable for 30 days`); },
    async newSwarm() { const v = await D().form({ title: 'New swarm', sub: 'A group of your Minds that work on one job together.', submit: 'Create', fields: [{ id: 'n', label: 'Name', required: true }, { id: 'm', label: 'Minds', type: 'checks', value: [], options: minds().map((m) => [m.name, `${m.name} — ${m.role}`]), validate: (x) => ((x || []).length < 2 ? 'Pick at least two.' : null) }, { id: 'p', label: 'How they work', type: 'seg', value: 'handoff', options: [['handoff', 'In turn'], ['broadcast', 'All at once'], ['orchestrate', 'One leads']] }] });
      if (!v) return; A().swarms.push({ id: 'sw' + rid(), name: v.n.trim(), members: v.m, pattern: v.p, lead: v.m[0] }); done('Swarm created'); },
    rmSwarm(id) { A().swarms = A().swarms.filter((s) => s.id !== id); done('Removed'); },
    runSwarm(id) { const s = A().swarms.find((x) => x.id === id); window.XA.animaChat(s.lead); },
  };
  document.addEventListener('click', (e) => { const t = e.target.closest('[data-an]'); if (!t || t.closest('.xd')) return; e.preventDefault(); e.stopPropagation(); window.XENO_NET?.begin('anima', t.dataset.an, t); Promise.resolve(ACT[t.dataset.an]?.(t.dataset.arg)).finally(() => window.XENO_NET?.clear(t)); }, true);
  document.addEventListener('input', (e) => { const t = e.target.closest('[data-an-q]'); if (!t) return; q = t.value; P() && window.XENO_PAGES.repaint('[data-an-q]'); });
  window.XENO_ANIMA = { route, minds };
})();
