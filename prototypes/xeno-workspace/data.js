// XENO Workspace shell — the data the shell renders. Placements follow XENO MODES - SPEC.md §3/§4
// (lock candidate, 2026-09-17). Status follows XENO PRODUCTS - CATALOG.md: 'live' = has a real
// product today, 'soon' = docs scaffold / planned. Icons come from xeno-product-icons/svg.
window.XENO_ICON_DIR = 'file:///X:/code/xeno-corporation/xeno-product-icons/svg/';
window.XENO_FILE_ICON_DIR = 'file:///X:/code/xeno-corporation/xeno-product-icons/file-icons/svg/';

// kind: 'desktop' (opens in Hub), 'web' (runs here), 'chat'
const P = (id, name, opts = {}) => ({ id, name, icon: opts.icon === undefined ? `xeno-${id}` : opts.icon, code: opts.code, status: opts.status || 'live', kind: opts.kind || 'desktop', blurb: opts.blurb || '' });

window.XENO_PRODUCTS = Object.fromEntries([
  // Studio
  P('pixel', 'Pixel', { blurb: 'Photo editing and illustration' }),
  P('motion', 'Motion', { blurb: 'Video editing and motion graphics' }),
  P('sound', 'Sound', { blurb: 'Music production and audio' }),
  P('photo', 'Photo', { status: 'soon', blurb: 'RAW workflow and library' }),
  P('form', 'Form', { blurb: '3D modelling and animation' }),
  P('architect', 'Architect', { blurb: 'Architecture and BIM' }),
  P('canvas', 'Canvas', { blurb: 'Product and UI design' }),
  P('layout', 'Layout', { status: 'soon', blurb: 'Multi-page layout' }),
  P('sites', 'Sites', { status: 'soon', kind: 'web', blurb: 'Websites and portfolios' }),
  P('image', 'Image', { icon: null, code: 'Im', kind: 'web', blurb: 'Generate and edit images' }),
  P('video', 'Video', { icon: null, code: 'Vi', kind: 'web', blurb: 'Generate video' }),
  P('audio', 'Audio', { icon: null, code: 'Au', kind: 'web', blurb: 'Voice, music and sound' }),
  P('3d', '3D', { kind: 'web', blurb: 'Generate 3D models' }),
  P('assets', 'Assets', { status: 'soon', kind: 'web', blurb: 'Brand kits and shared libraries' }),
  P('fonts', 'Fonts', { status: 'soon', kind: 'web', blurb: 'Fonts and pairing' }),
  P('stock', 'Stock', { status: 'soon', kind: 'web', blurb: 'Stock media' }),
  // Office
  P('docs', 'Docs', { blurb: 'Documents' }),
  P('sheets', 'Sheets', { blurb: 'Spreadsheets' }),
  P('slides', 'Slides', { blurb: 'Presentations' }),
  P('notes', 'Notes', { blurb: 'Notes and knowledge base' }),
  P('pdf', 'PDF', { status: 'soon', blurb: 'Edit, sign and fill PDFs' }),
  P('mail', 'Mail', { icon: null, code: 'Ma', status: 'soon', kind: 'web', blurb: 'Email' }),
  // Social
  P('post', 'Post', { kind: 'web', blurb: 'Publish to every network' }),
  P('comms', 'Comms', { blurb: 'Messages and calls' }),
  P('community', 'Community', { icon: null, code: 'Cm', kind: 'web', blurb: 'Run your own community' }),
  P('audience', 'Audience', { icon: null, code: 'Ad', status: 'soon', kind: 'web', blurb: 'Newsletters and memberships' }),
  P('xenopolis', 'Xenopolis', { status: 'soon', kind: 'web', blurb: 'The agent society' }),
  // Corpo
  P('company', 'Company', { kind: 'web', blurb: 'Your company, people and agents' }),
  P('seats', 'Teams & seats', { icon: null, code: 'Ts', kind: 'web', blurb: 'Members and seats' }),
  P('crm', 'CRM', { icon: null, code: 'Cr', status: 'soon', kind: 'web', blurb: 'Customers and pipeline' }),
  P('desk', 'Support Desk', { icon: null, code: 'Sd', status: 'soon', kind: 'web', blurb: 'Tickets and chat in one inbox' }),
  P('forms', 'Forms', { icon: null, code: 'Fm', status: 'soon', kind: 'web', blurb: 'Forms and surveys' }),
  P('scheduling', 'Scheduling', { icon: null, code: 'Sc', status: 'soon', kind: 'web', blurb: 'Booking pages' }),
  P('spectra', 'Spectra', { status: 'soon', kind: 'web', blurb: 'Analytics and dashboards' }),
  // Dev
  P('agent', 'Agent', { blurb: 'Build with agents' }),
  P('agent-cli', 'Agent CLI', { blurb: 'The agent in your terminal' }),
  P('agent-sdk', 'Agent SDK', { blurb: 'Embed the agent runtime' }),
  P('acp', 'ACP', { blurb: 'Drive any ACP agent' }),
  P('use', 'Use', { blurb: 'Computer use for agents' }),
  P('workflow', 'Workflow', { blurb: 'Automations' }),
  P('apps', 'Apps', { status: 'soon', kind: 'web', blurb: 'No-code app builder' }),
  P('engine', 'Engine', { blurb: 'Game engine' }),
  P('shell', 'Shell', { blurb: 'Desktop environment' }),
  P('spawn', 'Spawn', { blurb: 'Canvases of agents' }),
  P('rt', 'RT', { blurb: 'Local inference runtime' }),
  P('lib', 'Lib', { blurb: 'Native media library' }),
  // Tools (catalogue items)
  P('tool-resize', 'Image resize', { icon: 'xeno-tools', kind: 'web', blurb: 'Resize and convert images' }),
  P('tool-bg', 'Remove background', { icon: 'xeno-tools', kind: 'web', blurb: 'Cut out the subject' }),
  P('tool-upscale', 'Upscale', { icon: 'xeno-tools', kind: 'web', blurb: 'Enlarge without blur' }),
  P('tool-trim', 'Trim video', { icon: 'xeno-tools', kind: 'web', blurb: 'Cut a clip' }),
  P('tool-transcribe', 'Transcribe', { icon: 'xeno-tools', kind: 'web', blurb: 'Speech to text' }),
  P('tool-pdfmerge', 'Merge PDFs', { icon: 'xeno-tools', kind: 'web', blurb: 'Combine documents' }),
  P('tool-csv', 'CSV to sheet', { icon: 'xeno-tools', kind: 'web', blurb: 'Clean and import data' }),
  P('tool-json', 'JSON formatter', { icon: 'xeno-tools', kind: 'web', blurb: 'Format and validate' }),
  // Globals that open as products
  P('chat', 'Chat', { icon: null, code: 'Ch', kind: 'chat', blurb: 'Chat with XENO' }),
].map((p) => [p.id, p]));

window.XENO_MODES = [
  { id: 'studio', key: '1', persona: 'I make visual and audio things', start: 'canvas', pins: ['canvas', 'pixel', 'image'],
    sections: [['Create', ['pixel', 'motion', 'sound', 'photo', 'form', 'architect']], ['Design', ['canvas', 'layout', 'sites']], ['Generate', ['image', 'video', 'audio', '3d']], ['Libraries', ['assets', 'fonts', 'stock']]],
    metric: ['Renders this week', '128'] },
  { id: 'office', key: '2', persona: 'I do my work in documents', start: 'docs', pins: ['docs', 'sheets', 'slides'],
    sections: [['Write', ['docs']], ['Calculate', ['sheets']], ['Present', ['slides']], ['Notes', ['notes']], ['Mail', ['mail']], ['Files', ['pdf']]],
    metric: ['Documents edited', '24'] },
  { id: 'social', key: '3', persona: 'I reach and talk to people', start: 'post', pins: ['post', 'comms'],
    sections: [['Publish', ['post']], ['Message', ['comms']], ['Community', ['community']], ['Audience', ['audience']], ['Society', ['xenopolis']]],
    metric: ['Reach this week', '18.4k'] },
  { id: 'corpo', key: '4', persona: 'I run the business', start: 'company', pins: ['company', 'seats'],
    sections: [['Company', ['company']], ['People', ['seats']], ['Customers', ['crm', 'desk']], ['Forms', ['forms']], ['Scheduling', ['scheduling']], ['Analytics', ['spectra']]],
    metric: ['Open pipeline', '€42k'] },
  { id: 'dev', key: '5', persona: 'I build things that run', start: 'agent', pins: ['agent', 'workflow'],
    sections: [['Agents', ['agent', 'agent-cli', 'agent-sdk', 'acp', 'use']], ['Automate', ['workflow', 'apps']], ['Build', ['engine', 'shell', 'spawn']], ['SDKs', ['rt', 'lib']]],
    metric: ['Agent runs today', '37'] },
  { id: 'tools', key: '6', persona: 'I need a tool, not a product', start: 'tool-resize', pins: ['tool-resize', 'tool-bg'],
    sections: [['Image', ['tool-resize', 'tool-bg', 'tool-upscale']], ['Video', ['tool-trim']], ['Audio', ['tool-transcribe']], ['Documents', ['tool-pdfmerge']], ['Data', ['tool-csv']], ['Developer', ['tool-json']]],
    metric: ['Tools used', '9'] },
];

// recent work (sample), tagged by mode and product
window.XENO_RECENT = [
  { t: 'Brand refresh — homepage', p: 'canvas', m: 'studio', ago: '12 min' },
  { t: 'Product shot cleanup', p: 'pixel', m: 'studio', ago: '1 h' },
  { t: 'Neon city, 16:9', p: 'image', m: 'studio', ago: '2 h' },
  { t: 'Launch trailer v3', p: 'motion', m: 'studio', ago: 'Yesterday' },
  { t: 'Q4 planning', p: 'docs', m: 'office', ago: '35 min' },
  { t: 'Budget 2027', p: 'sheets', m: 'office', ago: '3 h' },
  { t: 'Investor update', p: 'slides', m: 'office', ago: 'Yesterday' },
  { t: 'Launch week thread', p: 'post', m: 'social', ago: '20 min' },
  { t: 'Team — design crit', p: 'comms', m: 'social', ago: '1 h' },
  { t: 'Hiring: 2 agents, 1 human', p: 'company', m: 'corpo', ago: '4 h' },
  { t: 'Refactor auth gate', p: 'agent', m: 'dev', ago: '8 min' },
  { t: 'Nightly asset sync', p: 'workflow', m: 'dev', ago: '2 h' },
  { t: 'Banner 1200×630', p: 'tool-resize', m: 'tools', ago: 'Today' },
];

window.XENO_CHATS = {
  projects: [['AWS certification', true, ['SAA practice quiz', 'EFS vs EBS for shared storage', 'VPC peering notes']], ['XENO launch', true, ['YC application draft', 'Pricing page copy']], ['Home renovation', false, ['Kitchen budget']], ['Reading list', false, []]],
  pinned: ['Weekly planning template'],
  recents: [['Today', ['SAA practice quiz', 'Python list comprehension', 'YC application draft']], ['Yesterday', ['Translate email to German', 'Kitchen budget']], ['Previous 7 days', ['Logo ideas', 'Trip to Lisbon', 'Regex for invoice numbers']]],
};

// The rail's mode zone: what changes with the mode. rows: [label, meta] or {p: productId}.
window.XENO_MODE_ZONES = {
  overview: [
    { id: 'recent', label: 'Recent', icon: 'clock', blurb: 'Your latest work from every mode', rows: 'recent' },
    { id: 'projects', label: 'Projects', icon: 'folder', blurb: 'Projects across the workspace', rows: [['Brand refresh', 'Studio'], ['Q4 planning', 'Office'], ['Launch week', 'Social'], ['Auth gate', 'Dev']] },
    { id: 'activity', label: 'Activity', icon: 'activity', blurb: 'What changed, and who changed it', rows: [['Atlas finished a research brief', '4 min'], ['Nightly asset sync ran', '2 h'], ['3 posts scheduled', '3 h'], ['Invoice paid', 'Yesterday']] },
  ],
  studio: [
    { id: 'create', label: 'Create', icon: 'create', blurb: 'Edit, design and produce', rows: [{ p: 'pixel' }, { p: 'motion' }, { p: 'sound' }, { p: 'canvas' }, { p: 'form' }, { p: 'architect' }] },
    { id: 'generate', label: 'Generate', icon: 'spark', blurb: 'Images, video, audio and 3D', rows: [{ p: 'image' }, { p: 'video' }, { p: 'audio' }, { p: '3d' }] },
    { id: 'libraries', label: 'Libraries', icon: 'lib', blurb: 'Assets, fonts and stock', rows: [{ p: 'assets' }, { p: 'fonts' }, { p: 'stock' }] },
    { id: 'renders', label: 'Renders', icon: 'film', blurb: 'Exports and renders', rows: [['Launch trailer v3.mp4', 'Rendering 64%'], ['Homepage hero.png', 'Done'], ['Podcast ep 12.wav', 'Done']] },
  ],
  office: [
    { id: 'documents', label: 'Documents', icon: 'doc', blurb: 'Docs, sheets, slides and notes', rows: [['Q4 planning', 'Docs'], ['Budget 2027', 'Sheets'], ['Investor update', 'Slides'], ['Meeting notes', 'Notes']] },
    { id: 'mail', label: 'Mail', icon: 'mail', blurb: 'Your inbox', rows: [['Contract draft — legal', '9:41'], ['Re: launch dates', 'Yesterday'], ['Invoice #2041', 'Mon']] },
    { id: 'files', label: 'Files', icon: 'folder', blurb: 'Everything you stored', rows: [['Brand guidelines.pdf', '2.1 MB'], ['Logo pack.zip', '18 MB'], ['Signed NDA.pdf', '340 KB']] },
    { id: 'calendar', label: 'Calendar', icon: 'calendar', blurb: 'Meetings and bookings', rows: [['Design crit', '14:00'], ['Investor call', 'Thu 10:00'], ['Team offsite', 'Oct 18']] },
  ],
  social: [
    { id: 'publish', label: 'Publish', icon: 'send', blurb: 'Schedule and publish', rows: [['Launch week thread', 'Today 18:00'], ['Behind the scenes reel', 'Tomorrow'], ['Newsletter #14', 'Fri']] },
    { id: 'inbox', label: 'Inbox', icon: 'inbox', blurb: 'Messages, replies and mentions', rows: [['@nova replied to your post', '3 min'], ['Team — design crit', '1 h'], ['2 new DMs', '2 h']] },
    { id: 'community', label: 'Community', icon: 'community', blurb: 'Your community', rows: [{ p: 'community' }, ['Unanswered questions', '4'], ['Reports to review', '1']] },
    { id: 'audience', label: 'Audience', icon: 'megaphone', blurb: 'Subscribers and memberships', rows: [{ p: 'audience' }, ['Subscribers', '12,480'], ['Members', '312']] },
  ],
  corpo: [
    { id: 'company', label: 'Company', icon: 'building', blurb: 'Your company', rows: [{ p: 'company' }, ['Wallet', '€4,210'], ['Seller account', 'Active']] },
    { id: 'people', label: 'People', icon: 'people', blurb: 'Humans and agents', rows: [['Emilian', 'Owner'], ['Atlas', 'Agent · Research'], ['Juno', 'Agent · Inbox'], { p: 'seats' }] },
    { id: 'customers', label: 'Customers', icon: 'handshake', blurb: 'CRM and support', rows: [{ p: 'crm' }, { p: 'desk' }] },
    { id: 'analytics', label: 'Analytics', icon: 'chart', blurb: 'Dashboards', rows: [{ p: 'spectra' }, ['Revenue this month', '€42k'], ['Open tickets', '7']] },
  ],
  dev: [
    { id: 'agents', label: 'Agents', icon: 'bot', blurb: 'Agent sessions', rows: [['Refactor auth gate', 'Running'], ['Fix flaky test', 'Waiting'], ['Release notes', 'Done'], { p: 'agent' }] },
    { id: 'runs', label: 'Runs', icon: 'play', blurb: 'Every run, with its cost', rows: [['run_8f2 · auth gate', '12 min · 4 cr'], ['run_7c1 · nightly sync', 'Done · 1 cr'], ['run_6a9 · docs', 'Failed']] },
    { id: 'automations', label: 'Automations', icon: 'flow', blurb: 'Workflows and schedules', rows: [{ p: 'workflow' }, ['Nightly asset sync', 'Daily 02:00'], ['Weekly report', 'Mon 09:00']] },
    { id: 'builds', label: 'Builds', icon: 'box', blurb: 'Builds and SDKs', rows: [{ p: 'engine' }, { p: 'agent-sdk' }, { p: 'rt' }, { p: 'lib' }] },
  ],
  tools: [
    { id: 'catalogue', label: 'Catalogue', icon: 'grid', blurb: 'Every tool', rows: [{ p: 'tool-resize' }, { p: 'tool-bg' }, { p: 'tool-upscale' }, { p: 'tool-trim' }, { p: 'tool-transcribe' }, { p: 'tool-pdfmerge' }, { p: 'tool-csv' }, { p: 'tool-json' }] },
    { id: 'recent-tools', label: 'Recent tools', icon: 'clock', blurb: 'Tools you used lately', rows: [{ p: 'tool-resize' }, { p: 'tool-bg' }] },
    { id: 'installed', label: 'Installed', icon: 'download', blurb: 'Tools on this device', rows: [{ p: 'tool-resize' }, { p: 'tool-transcribe' }, { p: 'tool-json' }] },
  ],
};

// live counts on the rail's mode zone: a number = new items, 'live' = something running
window.XENO_BADGES = { 'social.inbox': 3, 'office.mail': 2, 'dev.agents': 'live', 'dev.runs': 'live', 'studio.renders': 'live', 'overview.activity': 4, 'corpo.customers': 7 };

// models offered in the composer (sample catalogue; the live one comes from /api/models)
window.XENO_MODELS = {
  recommended: ['gpt-5.6-terra', 'claude-opus-5.5', 'gemini-3.8-flash'],
  list: [
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', provider: 'OpenAI', blurb: 'Best all-round for writing and code', tags: ['Reasoning', 'Vision'], cost: 4, effort: true },
    { id: 'gpt-5.6-mini', name: 'GPT-5.6 mini', provider: 'OpenAI', blurb: 'Quick answers, low cost', tags: ['Fast'], cost: 1, effort: true },
    { id: 'claude-opus-5.5', name: 'Claude Opus 5.5', provider: 'Anthropic', blurb: 'Deep work and long documents', tags: ['Reasoning', 'Vision'], cost: 6, effort: true },
    { id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5', provider: 'Anthropic', blurb: 'Balanced speed and quality', tags: ['Vision'], cost: 3, effort: true },
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'Google', blurb: 'Very fast, huge context', tags: ['Fast', 'Vision'], cost: 1, effort: true },
    { id: 'gemini-3.8-pro', name: 'Gemini 3.8 Pro', provider: 'Google', blurb: 'Strong reasoning across media', tags: ['Reasoning', 'Vision'], cost: 4, effort: true },
    { id: 'grok-4.3', name: 'Grok 4.3', provider: 'xAI', blurb: 'Current events and wit', tags: ['Fast'], cost: 2, effort: true },
  ],
};

// per-model facts for the detail card and effort limits (sample values)
window.XENO_MODEL_META = {
  'gpt-5.6-terra':     { speed: 3, tps: 118, depth: 4, ctx: '400k', maxEffort: 5, secs: 6 },
  'gpt-5.6-mini':      { speed: 5, tps: 240, depth: 2, ctx: '200k', maxEffort: 2, secs: 2 },
  'claude-opus-5.5':   { speed: 2, tps: 62, depth: 5, ctx: '1M',   maxEffort: 5, secs: 9 },
  'claude-sonnet-5.5': { speed: 4, tps: 135, depth: 3, ctx: '1M',   maxEffort: 3, secs: 4 },
  'gemini-3.8-flash':  { speed: 5, tps: 310, depth: 2, ctx: '1M',   maxEffort: 1, secs: 2 },
  'gemini-3.8-pro':    { speed: 3, tps: 104, depth: 4, ctx: '2M',   maxEffort: 4, secs: 6 },
  'grok-4.3':          { speed: 4, tps: 160, depth: 3, ctx: '256k', maxEffort: 3, secs: 3 },
};
window.XENO_EFFORT_HINT = ['Answers right away', 'A quick think first', 'Balanced — the usual choice', 'Thinks longer, for harder problems', 'Deep reasoning, for the hardest work', 'Everything it has — slow and thorough'];
