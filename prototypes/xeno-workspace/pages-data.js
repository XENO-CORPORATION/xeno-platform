// Page data — every object is shaped like the API response the real backend returns (XENO MODES
// SPEC §7d lists each contract). Sample values, real shapes: wiring the backend swaps the source,
// never the page. Times are minutes-ago so the prototype always reads as "now".
(() => {
  const NOW = Date.now(), ago = (min) => new Date(NOW - min * 60000).toISOString();

  // ── GET /api/v2/library/items?kind&source&view&q&sort&cursor → { items, total, nextCursor }
  //    GET /api/v2/library/summary → { total, byKind, bySource }   (one library, every product writes here)
  const LIB = [
    ['Launch trailer v3.mp4', 'video', 'motion', 'studio', 412_000_000, 8, { project: 'Brand refresh', w: 3840, h: 2160, dur: '1:42' }],
    ['Product shot.png', 'image', 'pixel', 'studio', 8_400_000, 35, { project: 'Brand refresh', w: 4000, h: 3000 }],
    ['Neon city, 16:9', 'image', 'image', 'studio', 2_100_000, 120, { chat: 'Neon city prompt tweaks', w: 1920, h: 1080 }],
    ['Brand refresh — homepage', 'design', 'canvas', 'studio', 14_200_000, 12, { project: 'Brand refresh' }],
    ['Podcast ep 12.wav', 'audio', 'sound', 'studio', 96_000_000, 300, { dur: '48:10' }],
    ['Logo sting 5s', 'video', 'video', 'studio', 11_000_000, 1440, { w: 1920, h: 1080, dur: '0:05' }],
    ['Narration — intro', 'audio', 'audio', 'studio', 3_200_000, 2900, { dur: '0:41' }],
    ['XENO lockup, dark.svg', 'image', 'pixel', 'studio', 48_000, 4300, { project: 'Brand refresh', w: 1200, h: 400 }],
    ['Moodboard — launch', 'image', 'image', 'studio', 6_600_000, 5800, { project: 'Brand refresh', w: 2400, h: 1600 }],
    ['Onboarding flow', 'design', 'canvas', 'studio', 9_100_000, 1500, {}],
    ['Q4 planning', 'document', 'docs', 'office', 210_000, 35, { project: 'Q4 planning' }],
    ['Budget 2027', 'sheet', 'sheets', 'office', 640_000, 180, { project: 'Q4 planning' }],
    ['Investor update', 'deck', 'slides', 'office', 22_000_000, 1460, {}],
    ['Brand guidelines.pdf', 'document', 'pdf', 'office', 2_100_000, 2900, { project: 'Brand refresh' }],
    ['Signed NDA.pdf', 'document', 'pdf', 'office', 340_000, 7200, { shared: 'Juno' }],
    ['Meeting notes', 'document', 'notes', 'office', 18_000, 60, {}],
    ['Hiring plan', 'document', 'docs', 'office', 120_000, 1500, {}],
    ['Launch week thread', 'post', 'post', 'social', 4_000, 20, { project: 'Launch week' }],
    ['Behind the scenes reel', 'video', 'post', 'social', 64_000_000, 90, { project: 'Launch week', dur: '0:38' }],
    ['Newsletter #14', 'document', 'audience', 'social', 32_000, 2800, { project: 'Launch week' }],
    ['Reel captions', 'chat', 'chat', 'social', 6_000, 200, { chat: 'Reel captions', project: 'Launch week' }],
    ['refactor-auth-gate.diff', 'code', 'agent', 'dev', 41_000, 8, { project: 'Auth gate' }],
    ['release-notes.md', 'code', 'agent', 'dev', 9_000, 1400, {}],
    ['nightly-sync.xflow', 'code', 'workflow', 'dev', 22_000, 120, {}],
    ['token-refresh.test.ts', 'code', 'agent', 'dev', 7_000, 60, { project: 'Auth gate', chat: 'Token refresh bug' }],
    ['Pricing page copy', 'chat', 'chat', 'overview', 12_000, 240, { chat: 'Pricing page copy', project: 'XENO launch' }],
    ['YC application draft', 'document', 'docs', 'overview', 88_000, 30, { project: 'XENO launch', chat: 'YC application draft' }],
    ['Kitchen budget', 'sheet', 'sheets', 'overview', 21_000, 9000, { shared: 'Mira' }],
    ['Hero render pass.png', 'image', 'canvas', 'studio', 5_200_000, 220, { project: 'Brand refresh', w: 2880, h: 1800 }],
    ['Colour tokens.json', 'code', 'canvas', 'studio', 6_000, 400, { project: 'Brand refresh' }],
  ].map(([name, kind, product, mode, bytes, min, x], i) => ({
    id: 'lib_' + (1000 + i), name, kind, bytes, createdAt: ago(min + 30), updatedAt: ago(min),
    source: { product, mode, chat: x.chat || null }, project: x.project || null, starred: [0, 3, 10, 21].includes(i),
    sharedBy: x.shared || null, media: x.w ? { width: x.w, height: x.h } : null, duration: x.dur || null, trashedAt: null,
  }));
  LIB.push(...[['Old logo concepts.png', 'image', 'pixel', 'studio', 3_000_000, 20000], ['Draft v1 — homepage', 'design', 'canvas', 'studio', 7_000_000, 15000]].map(([name, kind, product, mode, bytes, min], i) => ({
    id: 'lib_9' + i, name, kind, bytes, createdAt: ago(min + 900), updatedAt: ago(min + 600), source: { product, mode, chat: null }, project: null, starred: false, sharedBy: null, media: null, duration: null, trashedAt: ago(min),
  })));
  window.XENO_PG_LIBRARY = { items: LIB, quota: null };   // quota: null = the plan has no storage cap to show (honest default)

  // ── GET /api/v2/projects?status=active|shared|archived → { items, total }
  //    GET /api/v2/projects/:id → project + tasks + conversations + teams + resources + funding + activity
  const P = window.XENO_PROJECTS || {};
  const st = (s) => s.startsWith('Done') ? 'done' : s.startsWith('In review') ? 'review' : s.startsWith('In progress') ? 'doing' : s.startsWith('Scheduled') ? 'doing' : s.startsWith('Needs') ? 'review' : 'todo';
  Object.values(P).forEach((p) => { p.taskObjs = p.tasks.map(([t, s], i) => { const who = (s.split('·')[1] || '').trim(); return { id: 't' + i, title: t, state: st(s), assignee: who ? { name: who, kind: ['Atlas', 'Kit', 'Juno'].includes(who) ? 'agent' : 'human' } : null, note: s.split('·')[0].trim(), evidence: st(s) === 'done' ? 1 : st(s) === 'review' ? 1 : 0 }; }); });
  const meta = {
    'Brand refresh': { status: 'active', health: 'on_track', due: 'Oct 31', members: [['Emilian', 'human'], ['Mira', 'human'], ['Atlas', 'agent'], ['Nova', 'human']], needs: 1, updated: 12 },
    'Q4 planning': { status: 'active', health: 'at_risk', due: 'Oct 18', members: [['Emilian', 'human'], ['Juno', 'agent']], needs: 0, updated: 180 },
    'Launch week': { status: 'active', health: 'on_track', due: 'Fri', members: [['Emilian', 'human'], ['Nova', 'human'], ['Echo', 'agent'], ['Juno', 'agent']], needs: 2, updated: 20 },
    'Auth gate': { status: 'active', health: 'blocked', due: 'Oct 10', members: [['Emilian', 'human'], ['Kit', 'agent'], ['Atlas', 'agent']], needs: 1, updated: 60 },
    'XENO launch': { status: 'active', health: 'on_track', due: 'Nov 1', members: [['Emilian', 'human']], needs: 0, updated: 30 },
  };
  const extra = [
    ['Partner co-marketing', 'Social', 'Nova', 'shared', 'on_track', 'Joint webinar announced', 3, 7, [['Nova', 'human'], ['Emilian', 'human']], 4300],
    ['Home reno', 'Overview', 'Mira', 'shared', 'on_track', 'Kitchen quote accepted', 2, 9, [['Mira', 'human'], ['Emilian', 'human']], 9000],
    ['Spring campaign', 'Social', 'Emilian', 'archived', 'done', 'Campaign wrapped', 12, 12, [['Emilian', 'human']], 90000],
    ['Website v2', 'Studio', 'Emilian', 'archived', 'done', 'Shipped', 18, 18, [['Emilian', 'human'], ['Mira', 'human']], 140000],
  ];
  const list = Object.entries(P).map(([name, p], i) => { const m = meta[name] || { status: 'active', health: 'on_track', due: '—', members: [], needs: 0, updated: 999 };
    return { id: 'prj_' + (10 + i), name, mode: p.mode, owner: { name: p.owner, kind: 'human' }, status: m.status, health: m.health, goal: p.goal, milestone: { title: p.milestone, due: m.due },
      tasks: { total: Math.max(p.taskObjs.length, +(p.progress.match(/of (\d+)/) || [])[1] || p.taskObjs.length), done: +(p.progress.match(/^(\d+) of/) || [])[1] || p.taskObjs.filter((t) => t.state === 'done').length },
      members: m.members.map(([n, k]) => ({ name: n, kind: k })), needsYou: m.needs, updatedAt: ago(m.updated) }; });
  extra.forEach(([name, mode, owner, status, health, ms, done, total, mem, min], i) => list.push({ id: 'prj_' + (40 + i), name, mode, owner: { name: owner, kind: 'human' }, status, health, goal: '', milestone: { title: ms, due: status === 'archived' ? 'Done' : 'Nov 12' }, tasks: { total, done }, members: mem.map(([n, k]) => ({ name: n, kind: k })), needsYou: 0, updatedAt: ago(min) }));
  window.XENO_PG_PROJECTS = { items: list };

  // ── GET /api/v2/workspaces/:id → { name, plan, divisions } · /members → { items } (kind human|agent, WORKFORCE §11.2)
  //    /teams · /knowledge · /automations · /activity · /settings
  window.XENO_PG_WORKSPACE = {
    name: 'XENO Corp', plan: 'Team', you: { role: 'owner' },
    members: [
      ['Emilian', 'human', 'owner', 'Founder', ['Studio', 'Dev'], 0, 'active'], ['Mira', 'human', 'admin', 'Design lead', ['Studio'], 40, 'active'],
      ['Nova', 'human', 'member', 'Growth', ['Social'], 180, 'active'], ['Rui', 'human', 'member', 'Engineer', ['Dev'], 1500, 'active'],
      ['Ana', 'human', 'member', 'Operations', ['Office'], 3000, 'active'], ['Sam', 'human', 'guest', 'Contractor — legal', ['Office'], 9000, 'invited'],
      ['Atlas', 'agent', 'member', 'Research', ['Studio', 'Dev'], 2, 'running'], ['Kit', 'agent', 'member', 'Code review', ['Dev'], 60, 'idle'],
      ['Juno', 'agent', 'member', 'Inbox and invoices', ['Office', 'Corpo'], 15, 'idle'], ['Echo', 'agent', 'member', 'Social replies', ['Social'], 5, 'running'],
    ].map(([name, kind, role, title, divisions, min, status], i) => ({ id: 'mem_' + i, name, kind, role, title, divisions, lastActiveAt: ago(min), status, ownedBy: kind === 'agent' ? 'Emilian' : null })),
    teams: [['Design', 'Mira', ['Mira', 'Nova', 'Atlas'], 'Brand refresh'], ['Platform', 'Rui', ['Rui', 'Emilian', 'Kit', 'Atlas'], 'Auth gate'], ['Growth', 'Nova', ['Nova', 'Echo', 'Juno'], 'Launch week']]
      .map(([name, lead, members, project], i) => ({ id: 'team_' + i, name, lead, members, projects: [project] })),
    knowledge: [['Brand guidelines.pdf', 'File', 'Everyone', 2900], ['xeno-platform', 'Repository', 'Platform', 60], ['Product principles', 'Notes page', 'Everyone', 1500], ['Support macros', 'Docs folder', 'Growth', 7200]]
      .map(([name, kind, access, min], i) => ({ id: 'kn_' + i, name, kind, access, indexedAt: ago(min) })),
    automations: [['Nightly asset sync', 'Daily 02:00', 'ok', 'Workflow'], ['Weekly report', 'Mon 09:00', 'ok', 'Workflow'], ['Lead enrich', 'On webhook', 'failed', 'Workflow'], ['Triage inbox', 'On new mail', 'ok', 'Juno']]
      .map(([name, trigger, last, by], i) => ({ id: 'au_' + i, name, trigger, lastRun: last, owner: by })),
    activity: [['Atlas moved "Homepage hero" to review', 12, 'agent'], ['Mira invited Sam as a guest', 300, 'human'], ['Kit asked a question in "Fix flaky test"', 60, 'agent'], ['Lead enrich failed — webhook timed out', 140, 'system'], ['Emilian assigned Design to Brand refresh', 4300, 'human']]
      .map(([text, min, kind], i) => ({ id: 'ac_' + i, text, kind, at: ago(min) })),
    divisions: [['Studio', 2, 1], ['Office', 2, 1], ['Social', 1, 2], ['Dev', 2, 2]].map(([name, people, agents]) => ({ name, people, agents })),
  };

  // ── Per-area work tables (GET /api/v2/modes/:mode/areas/:area/items). Columns are the area's own nouns.
  window.XENO_PG_AREAS = {
    'dev.agents': { noun: 'Sessions', cols: ['Session', 'Workspace', 'Agent', 'Status', 'Duration', 'Cost', 'Started'], filters: ['All', 'Running', 'Waiting on you', 'Done', 'Failed'],
      rows: [['Refactor auth gate', 'xeno-platform', 'Atlas', 'Running', '14 min', '38 cr', 14, 'agent'], ['Fix flaky test', 'xeno-canvas', 'Kit', 'Waiting on you', '6 min', '12 cr', 180, 'agent'], ['Release notes', 'xeno-hub', 'Kit', 'Done', '3 min', '6 cr', 1400, 'agent'], ['Upgrade electron', 'xeno-motion', 'Atlas', 'Failed', '22 min', '51 cr', 2900, 'agent'], ['Write tests for parser', 'xeno-sheets', 'Kit', 'Done', '9 min', '19 cr', 4300, 'agent']] },
    'dev.automate': { noun: 'Runs', cols: ['Workflow', 'Trigger', 'Status', 'Duration', 'Cost', 'Last run'], filters: ['All', 'Running', 'Done', 'Failed'],
      rows: [['Nightly asset sync', 'Daily 02:00', 'Done', '41 s', '1 cr', 420, 'workflow'], ['Weekly report', 'Mon 09:00', 'Done', '2 min', '3 cr', 8600, 'workflow'], ['Lead enrich', 'On webhook', 'Failed', '30 s', '0 cr', 140, 'workflow'], ['Render queue watcher', 'Every 5 min', 'Running', '—', '—', 2, 'workflow']] },
    'studio.create': { noun: 'Renders', cols: ['File', 'Product', 'Status', 'Size', 'Updated'], filters: ['All', 'Rendering', 'Done'],
      rows: [['Launch trailer v3.mp4', 'Motion', 'Rendering 64%', '412 MB', 8, 'motion'], ['Product shot.png', 'Pixel', 'Done', '8.4 MB', 35, 'pixel'], ['Podcast ep 12.wav', 'Sound', 'Done', '96 MB', 300, 'sound']] },
    'social.publish': { noun: 'Queue', cols: ['Post', 'Channels', 'Status', 'Scheduled'], filters: ['All', 'Scheduled', 'Needs approval', 'Draft'],
      rows: [['Launch week thread', 'X · LinkedIn', 'Scheduled', 'Today 18:00', 20, 'post'], ['Behind the scenes reel', 'Instagram', 'Needs approval', 'Tomorrow', 90, 'post'], ['Newsletter #14', 'Email', 'Draft', 'Fri', 2800, 'post']] },
  };

  // ── GET /api/v2/anima/minds · /soul · /chats  (Mind = authored seed, Soul = earned memory; ANIMA SPEC)
  window.XENO_PG_ANIMA = {
    minds: [['Atlas', 'Research', 'running', 'Summarising 14 competitor sites', 1204, 9], ['Juno', 'Inbox and invoices', 'idle', 'Last: triaged 6 emails', 412, 5], ['Kit', 'Code review', 'idle', 'Last: reviewed PR #212', 860, 3]]
      .map(([name, role, status, now, episodes, skills], i) => ({ id: 'mind_' + i, name, role, status, now, soul: { episodes, skills } })),
    skills: [['Write release notes from a diff', 'Kit', 1400], ['File an invoice into Sheets', 'Juno', 3000], ['Compare pricing pages', 'Atlas', 300], ['Draft a reply in your voice', 'Juno', 9000]].map(([name, by, min]) => ({ name, learnedBy: by, at: ago(min) })),
  };

  // ── GET /api/forum/threads?space&sort (FORUM SPEC: the Record is unranked; Feed is ranked by time-to-resolution)
  window.XENO_PG_FORUM = [
    ['How do I export a Canvas frame as SVG with live text?', 'Questions', 'Rhea', 'human', 3, 'answered', 45], ['Agent sessions keep asking permission for the same folder', 'Questions', 'dev-ops-bot', 'agent', 5, 'open', 120],
    ['Showcase: a full music video cut in Motion', 'Showcase', 'Tomas', 'human', 12, 'open', 300], ['Proposal: keyboard shortcut for Report a problem in Hub', 'Feedback', 'Ines', 'human', 8, 'planned', 1400],
    ['XENO Agent 0.4 — what changed', 'Announcements', 'XENO', 'human', 21, 'open', 2900], ['Best way to share a brand kit with an agency?', 'Discussions', 'Mara', 'human', 4, 'open', 4300],
  ].map(([title, space, author, kind, replies, state, min], i) => ({ id: 'th_' + i, title, space, author: { name: author, kind }, replies, state, lastActivityAt: ago(min) }));

  // ── GET /api/marketplace/listings?mode=apps|agents&kind (MARKETPLACE SPEC D1/D5: price model + trust tier)
  window.XENO_PG_MARKET = [
    ['Background remover', 'apps', 'tool', 'XENO', 'official', 'Free', 'Removes backgrounds in Pixel, Canvas and Library'], ['Brand checker', 'apps', 'block', 'Lumen Studio', 'verified', '€4 / month', 'Flags off-brand colours and fonts in any design'],
    ['Figma import', 'apps', 'plugin', 'XENO', 'official', 'Free', 'Bring Figma files into Canvas'], ['Postgres MCP', 'apps', 'mcp', 'DataWorks', 'community', 'Free', 'Let agents query your database read-only'],
    ['SaaS onboarding blueprint', 'apps', 'blueprint', 'XENO', 'official', '€29', 'Sign-up, billing and roles — proven and wired'], ['Atlas — research Mind', 'agents', 'mind', 'XENO', 'official', 'Rent · 2 cr / task', 'Researches, compares and writes a cited brief'],
    ['Support team', 'agents', 'team', 'Helpwise', 'verified', '€19 / month', 'Three agents that answer, route and follow up tickets'], ['Bookkeeper', 'agents', 'mind', 'Ledgerly', 'verified', 'Rent · 1 cr / task', 'Files receipts and reconciles your sheets'],
    ['Qwen 3.6 — local', 'agents', 'model', 'XENO', 'official', 'Free', 'Runs on your machine through XENO RT'],
  ].map(([name, mode, kind, seller, trust, price, blurb], i) => ({ id: 'lst_' + i, name, mode, kind, seller, trust, price, blurb, owned: [0, 5].includes(i) }));

  // ── The sidebars read the SAME data the pages do, so a count can never disagree with its page
  // ── Home sections: each shaped like the feed it would come from (render queue, run log, schedule, mail,
  //    calendar, ledger). Sample values; the signature sections render ONLY from these.
  window.XENO_HOME = {
    studio: { jobs: [{ name: 'Launch trailer v3.mp4', product: 'motion', stage: 1, pct: 64, frames: 2448, fps: 24, res: '3840 × 2160', codec: 'H.265', startedMin: 7 }],
      queued: [['Teaser 15s cutdown', 'motion', 'Waits for the trailer'], ['Hero stills ×12', 'pixel', 'Batch export']] },
    dev: { logs: { 'Refactor auth gate': ['read  src/server/auth/gate.js', 'edit  src/server/auth/gate.js  +44 −12', 'edit  src/server/auth/refresh.js  +19 −40', 'run   npm test -- auth', '  ✓ refresh rotates the token family', '  ✓ revoked family is refused', '  ✓ gate allows an approved build', '  … 38 more'], 'Fix flaky test': ['edit  tests/sync.test.ts  +8 −2', 'run   npm test -- sync   41 passed', '? Can I delete the retry wrapper? Only this test uses it.'] },
      schedule: [['Nightly asset sync', 'Daily 02:00', [[2, 'ok']], 'workflow'], ['Render queue watcher', 'Every 4 h', [[0, 'ok'], [4, 'ok'], [8, 'ok'], [12, 'ok'], [16, 'ok'], [20, 'ok']], 'workflow'], ['Lead enrich', 'On webhook', [[9, 'ok'], [11, 'ok'], [13, 'failed'], [15, 'failed']], 'workflow'], ['Weekly report', 'Mon 09:00', [[9, 'next']], 'workflow']] },
    social: { posts: [['Launch week thread', 0, 18, ['X', 'in'], 'scheduled'], ['Behind the scenes reel', 1, 12, ['IG'], 'approval'], ['Customer story carousel', 2, 10, ['in', 'IG'], 'scheduled'], ['Newsletter #14', 4, 9, ['Mail'], 'draft'], ['AMA reminder', 4, 17, ['X'], 'scheduled'], ['Weekend recap', 6, 11, ['X', 'IG'], 'draft']],
      reach: [2100, 2600, 2300, 3100, 2900, 3600, 1800],
      conv: [['Nova', 'X', 'Can we quote this in our deck?', 3, true], ['Team — design crit', 'Comms', 'Mira: v3 of the hero is up', 60, false], ['@lumen_studio', 'IG', 'Loved the reel — collab?', 140, true], ['Launch war room', 'Comms', 'Echo drafted 4 replies for review', 1440, false]] },
    office: { agenda: [[9.5, 10, 'Stand-up', 'Team · 6'], [11, 12, 'Board memo review', 'Leadership · Docs'], [14, 14.5, 'Hiring sync', 'Ana, Juno (agent)'], [16, 17, 'Investor update dry-run', 'Slides']],
      mail: [['Legal — Dana Pierce', 'human', 'Contract draft — final redlines', 'Two changes in §4: the liability cap and the notice period…', 9, true, false], ['Juno', 'agent', 'Invoice #2041 filed into Budget 2027', 'Matched to the Acme PO. Nothing for you to do unless the amount looks wrong.', 47, false, false], ['Mira Chen', 'human', 'Re: launch dates', 'Thursday works for the press embargo if legal signs off by Tuesday…', 300, true, true], ['Ana Ruiz', 'human', 'Offsite venues — 3 options', 'Shortlisted three places within an hour of the office, prices attached.', 1500, false, true]] },
    corpo: { revenue: [980, 1100, 1040, 1210, 1300, 1180, 1420, 1390, 1500, 1460, 1620, 1580, 1700, 1650, 1820, 1760, 1900, 1870, 2010, 1980, 2150, 2090, 2240, 2200, 2380, 2310, 2460, 2420, 2590, 2560],
      pipeline: [['Lead', 24, 86000], ['Qualified', 11, 52000], ['Proposal', 6, 31000], ['Won', 3, 12000]],
      tickets: [['Login loop on Safari', 'Acme', 25, 60, 'Juno'], ['Invoice shows wrong VAT', 'Lumen', 95, 240, 'Ana'], ['Export to PDF cuts tables', 'Northwind', 180, 480, 'Kit']] },
  };
  // ── Persistence stand-in: every change is written here and read back on load, so a refresh keeps what you
  //    did — the job the backend does in the real app. One key, versioned; 'Clear this device' never touches it.
  const DB_KEY = 'xw.db.v1', DB_SETS = { projects: () => window.XENO_PROJECTS, projectList: () => window.XENO_PG_PROJECTS.items, workspace: () => window.XENO_PG_WORKSPACE, library: () => window.XENO_PG_LIBRARY.items, forum: () => window.XENO_PG_FORUM, anima: () => window.XENO_PG_ANIMA, chats: () => window.XENO_CHATS_BY_CTX, market: () => window.XENO_PG_MARKET, needs: () => window.XENO_NEEDS, areas: () => window.XENO_PG_AREAS, recent: () => window.XENO_RECENT, home: () => window.XENO_HOME };
  try { const saved = JSON.parse(localStorage.getItem(DB_KEY) || 'null');
    if (saved) { if (saved.projects) window.XENO_PROJECTS = saved.projects; if (saved.projectList) window.XENO_PG_PROJECTS.items = saved.projectList; if (saved.workspace) window.XENO_PG_WORKSPACE = saved.workspace; if (saved.library) window.XENO_PG_LIBRARY.items = saved.library; if (saved.forum) window.XENO_PG_FORUM = saved.forum; if (saved.anima) window.XENO_PG_ANIMA = saved.anima; if (saved.chats) window.XENO_CHATS_BY_CTX = saved.chats; if (saved.market) window.XENO_PG_MARKET = saved.market; if (saved.needs) window.XENO_NEEDS = saved.needs; if (saved.areas) window.XENO_PG_AREAS = saved.areas; if (saved.recent) window.XENO_RECENT = saved.recent; if (saved.home) window.XENO_HOME = saved.home; } } catch {}
  let dbReady = false;
  window.XENO_DB = { save() { if (!dbReady) return; try { localStorage.setItem(DB_KEY, JSON.stringify(Object.fromEntries(Object.entries(DB_SETS).map(([k, f]) => [k, f()])))); } catch {} }, reset() { try { localStorage.removeItem(DB_KEY); } catch {} } };
  // a function, so every change (create, rename, trash, invite) re-derives the sidebar from the same data
  window.XENO_PG_SYNC_NAV = () => { const LIB = window.XENO_PG_LIBRARY.items;
  const G = window.XENO_GLOBAL_NAV, n = (x) => x.toLocaleString('en');
  if (G) {
    const live = LIB.filter((f) => !f.trashedAt), byK = (ks) => live.filter((f) => ks.includes(f.kind)).length, byM = (m) => live.filter((f) => f.source.mode === m).length;
    G.library[3] = [['Browse', [['All files', n(live.length)], ['Images', n(byK(['image']))], ['Video', n(byK(['video']))], ['Audio', n(byK(['audio']))], ['Documents', n(byK(['document', 'sheet', 'deck', 'post']))], ['Code & artifacts', n(byK(['code', 'chat', 'design']))]]],
      ['From', [['From chats', n(live.filter((f) => f.source.chat).length)], ['Studio', n(byM('studio'))], ['Office', n(byM('office'))], ['Social', n(byM('social'))], ['Dev', n(byM('dev'))]]],
      ['Yours', [['Starred', n(live.filter((f) => f.starred).length)], ['Shared with me', n(live.filter((f) => f.sharedBy).length)], ['Trash', String(LIB.filter((f) => f.trashedAt).length || '')]]]];
    const W = window.XENO_PG_WORKSPACE, hum = W.members.filter((m) => m.kind === 'human').length, ag = W.members.filter((m) => m.kind === 'agent').length, pl = (k, a, b) => `${k} ${k === 1 ? a : b}`;
    const div = (d) => [d, pl(W.members.filter((m) => m.kind === 'human' && m.divisions.includes(d)).length, 'person', 'people') + ' · ' + pl(W.members.filter((m) => m.kind === 'agent' && m.divisions.includes(d)).length, 'agent', 'agents')];
    W.divisions.forEach((d) => { d.people = W.members.filter((m) => m.kind === 'human' && m.divisions.includes(d.name)).length; d.agents = W.members.filter((m) => m.kind === 'agent' && m.divisions.includes(d.name)).length; });
    G.workspace[3] = [['Manage', [['Members', `${pl(hum, 'person', 'people')} · ${pl(ag, 'agent', 'agents')}`], ['Agents', `${ag} assigned`], ['Teams', String(W.teams.length)], ['Divisions', W.divisions.length ? String(W.divisions.length) : 'None'], ['Handoffs', window.XENO_WF ? String(window.XENO_WF.pendingForMe() || '') : ''], ['Decisions', ''], ['Knowledge', pl(W.knowledge.length, 'source', 'sources')], ['Automations', `${W.automations.filter((a) => a.lastRun !== 'failed').length} healthy · ${W.automations.filter((a) => a.lastRun === 'failed').length} failing`], ['Activity', `${W.activity.length} new`], ['Settings', '']]],
      ['Divisions', W.divisions.map((d) => div(d.name))], ['Across all workspaces', [['All my agents', String(ag)], ['All my teams', String(W.teams.length)], ['Switch workspace', window.XA ? `${window.XA.workspaces().length} workspaces` : '']]]];
    const PL = window.XENO_PG_PROJECTS.items, act = PL.filter((p) => p.status === 'active');
    G.projects[3] = [['Active', act.map((p) => [p.name, `${p.mode} · ${p.tasks.done}/${p.tasks.total}`])], ['Shared with me', PL.filter((p) => p.status === 'shared').map((p) => [p.name, p.mode])], ['Archive', [['Archived projects', String(PL.filter((p) => p.status === 'archived').length)]]]];
    const MK = window.XENO_PG_MARKET; G.market[3][2][1] = [['Purchases', String(MK.filter((x) => x.owned && !/Rent/.test(x.price)).length)], ['Rentals', String(MK.filter((x) => x.owned && /Rent/.test(x.price)).length)], ['Seller console', '']];
  }
  window.XENO_DB.save(); }; window.XENO_PG_SYNC_NAV(); dbReady = true;

  // ── GET /api/v2/modes/:mode/metrics?range=7d → [{ id, label, value, unit, series:[7 daily values], area }]
  //    Each number links to the place it measures. The first one is the mode's headline (Overview's mode cards).
  window.XENO_MODE_KPIS = {
    studio: [['renders', 'Renders this week', 128, '', [9, 14, 12, 21, 18, 24, 30], 'create'], ['generations', 'Generations', 342, '', [40, 38, 52, 47, 61, 49, 55], 'generate'], ['storage', 'Library added', 2.4, 'GB', [0.2, 0.3, 0.1, 0.5, 0.4, 0.3, 0.6], 'libraries']],
    office: [['docs', 'Documents edited', 24, '', [2, 5, 3, 4, 6, 1, 3], 'write'], ['sheets', 'Sheets updated', 9, '', [1, 2, 1, 0, 3, 1, 1], 'calculate'], ['mail', 'Mail answered', 61, '', [8, 11, 9, 7, 12, 6, 8], 'mail']],
    social: [['reach', 'Reach this week', 18400, '', [1800, 2100, 2600, 2300, 3100, 2900, 3600], 'publish'], ['posts', 'Posts published', 11, '', [1, 2, 1, 3, 1, 2, 1], 'publish'], ['replies', 'Conversations', 46, '', [5, 7, 6, 9, 4, 8, 7], 'message']],
    corpo: [['pipeline', 'Open pipeline', 42000, '€', [36000, 37500, 38000, 39200, 40100, 41000, 42000], 'customers'], ['tickets', 'Open tickets', 7, '', [11, 10, 9, 9, 8, 8, 7], 'customers'], ['wallet', 'Wallet', 4210, '€', [5100, 4980, 4800, 4650, 4500, 4390, 4210], 'company']],
    dev: [['runs', 'Agent runs today', 37, '', [22, 28, 31, 25, 33, 29, 37], 'agents'], ['success', 'Runs that passed', 89, '%', [82, 85, 84, 88, 86, 90, 89], 'agents'], ['spend', 'Agent spend', 126, 'cr', [90, 104, 98, 120, 111, 131, 126], 'agents']],
    tools: [['used', 'Tools used', 9, '', [1, 2, 0, 3, 1, 1, 1], 'image'], ['files', 'Files processed', 64, '', [6, 9, 4, 12, 8, 11, 14], 'image'], ['saved', 'Time saved', 3.1, 'h', [0.2, 0.4, 0.3, 0.6, 0.4, 0.5, 0.7], 'image']],
  };
  Object.keys(window.XENO_MODE_KPIS).forEach((m) => { window.XENO_MODE_KPIS[m] = window.XENO_MODE_KPIS[m].map(([id, label, value, unit, series, area]) => ({ id, label, value, unit, series, area })); });
})();
