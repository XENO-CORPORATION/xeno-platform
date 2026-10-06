// What every sidebar panel holds. One rule per panel kind (see /isg 2026-10-03):
//   rail = destinations · panel = the destination's own OBJECTS, never a second launcher.
// Sources: XENO MODES - SPEC.md §3 (sections) + §7 (sidebar = the mode's products in its sections),
// XENO-WORKFORCE-01 §11.2 (workspace views: Conversations · Projects · Teams · Agents · Automations)
// and §8.2c/§8.5 (handoffs, runs that need a human), each product's own SPEC/README for its nouns.
// Rows: [label, meta] or [label, meta, productId]. Sample data — every row is illustrative.

// ── "Needs you": the workforce states that require a human (WORKFORCE §8.2c handoff `offered`,
//    §8.5 run `waiting_for_user` / `waiting_for_permission`, Post approvals). Global chrome per
//    MODES §4, so it leads Overview and is filtered per mode in each mode panel.
window.XENO_NEEDS = [
  { t: 'Atlas wants to run a migration', meta: 'Approve', m: 'dev', p: 'agent', kind: 'permission' },
  { t: 'Juno handed you "Invoice #2041"', meta: 'Accept', m: 'corpo', p: 'company', kind: 'handoff' },
  { t: '2 posts waiting for approval', meta: 'Review', m: 'social', p: 'post', kind: 'approval' },
  { t: 'Launch trailer v3 finished rendering', meta: 'Open', m: 'studio', p: 'motion', kind: 'done' },
  { t: 'Kit asked a question in "Fix flaky test"', meta: 'Reply', m: 'dev', p: 'agent', kind: 'question' },
];
window.XENO_PINNED = [['Brand refresh — homepage', 'canvas'], ['Q4 planning', 'docs'], ['Refactor auth gate', 'agent']];

// ── Zones = the mode's SECTIONS (MODES §3), exactly. A zone panel holds that section's products
//    AND the work living in them — so the mode panel never repeats it.
window.XENO_MODE_ZONES = {
  overview: [],  // workspace objects moved to the rail (Projects, Library, Workspace) — not repeated here
  studio: [
    { id: 'create', label: 'Create', icon: 'create', blurb: 'Edit, design and produce', products: ['pixel', 'motion', 'sound', 'photo', 'form', 'architect'],
      work: ['Renders', [['Launch trailer v3.mp4', 'Rendering 64%', 'motion'], ['Product shot.png', 'Done', 'pixel'], ['Podcast ep 12.wav', 'Done', 'sound']]] },
    { id: 'design', label: 'Design', icon: 'grid', blurb: 'Interfaces, layouts and sites', products: ['canvas', 'layout', 'sites'],
      work: ['Files', [['Brand refresh — homepage', '12 min', 'canvas'], ['Onboarding flow', 'Yesterday', 'canvas']]] },
    { id: 'generate', label: 'Generate', icon: 'spark', blurb: 'Images, video, audio and 3D', products: ['image', 'video', 'audio', '3d'],
      work: ['Generations', [['Neon city, 16:9', '2 h', 'image'], ['Logo sting 5s', 'Yesterday', 'video'], ['Narration — intro', 'Mon', 'audio']]] },
    { id: 'libraries', label: 'Libraries', icon: 'palette', blurb: 'Brand kits, fonts and stock', products: ['assets', 'fonts', 'stock'],
      work: ['Libraries', [['XENO brand kit', '214 assets'], ['Launch moodboard', '38 assets']]] },
  ],
  office: [
    { id: 'write', label: 'Write', icon: 'doc', blurb: 'Documents', products: ['docs'], work: ['Documents', [['Q4 planning', '35 min', 'docs'], ['Hiring plan', 'Yesterday', 'docs']]] },
    { id: 'calculate', label: 'Calculate', icon: 'grid', blurb: 'Spreadsheets', products: ['sheets'], work: ['Sheets', [['Budget 2027', '3 h', 'sheets'], ['Pipeline', 'Mon', 'sheets']]] },
    { id: 'present', label: 'Present', icon: 'layers', blurb: 'Presentations', products: ['slides'], work: ['Decks', [['Investor update', 'Yesterday', 'slides']]] },
    { id: 'notes', label: 'Notes', icon: 'edit', blurb: 'Notes and knowledge', products: ['notes'], work: ['Favorites', [['Meeting notes', 'Today', 'notes'], ['Product principles', 'Pinned', 'notes']]] },
    { id: 'mail', label: 'Mail', icon: 'mail', blurb: 'Your inbox', products: ['mail'], work: ['Inbox', [['Contract draft — legal', '9:41', 'mail'], ['Re: launch dates', 'Yesterday', 'mail'], ['Invoice #2041', 'Mon', 'mail']]] },
    { id: 'files', label: 'Files', icon: 'folder', blurb: 'PDFs and everything you stored', products: ['pdf'], work: ['Files', [['Brand guidelines.pdf', '2.1 MB', 'pdf'], ['Signed NDA.pdf', '340 KB', 'pdf']]] },
  ],
  social: [
    { id: 'publish', label: 'Publish', icon: 'send', blurb: 'Schedule and publish', products: ['post'], work: ['Queue', [['Launch week thread', 'Today 18:00', 'post'], ['Behind the scenes reel', 'Tomorrow', 'post'], ['Newsletter #14', 'Fri', 'post']]] },
    { id: 'message', label: 'Message', icon: 'chat', blurb: 'Conversations and calls', products: ['comms'], work: ['Conversations', [['Team — design crit', '1 h', 'comms'], ['Nova', '3 min', 'comms'], ['Launch war room', 'Yesterday', 'comms']]] },
    { id: 'community', label: 'Community', icon: 'layers', blurb: 'Communities you run (XENO\'s own forum is in the rail)', products: ['community'], work: ['Spaces', [['Help & questions', '4 unanswered', 'community'], ['Showcase', '12 new', 'community']]] },
    { id: 'audience', label: 'Audience', icon: 'megaphone', blurb: 'Subscribers and memberships', products: ['audience'], work: ['Lists', [['Newsletter', '12,480'], ['Members', '312']]] },
    { id: 'society', label: 'Society', icon: 'star', blurb: 'The agent society', products: ['xenopolis'] },
  ],
  corpo: [
    { id: 'company', label: 'Company', icon: 'building', blurb: 'Your company', products: ['company'], work: ['Company', [['Wallet', '€4,210', 'company'], ['Seller account', 'Active', 'company'], ['Divisions', '5', 'company']]] },
    { id: 'people', label: 'People', icon: 'people', blurb: 'Humans and agents', products: ['seats'], work: ['Members', [['Emilian', 'Owner'], ['Atlas', 'Agent · Research'], ['Juno', 'Agent · Inbox']]] },
    { id: 'customers', label: 'Customers', icon: 'handshake', blurb: 'CRM and support — one inbox with Comms', products: ['crm', 'desk'], work: ['Open', [['Acme renewal', '€12k · this week', 'crm'], ['Login issue', 'Ticket · 2 h', 'desk']]] },
    { id: 'forms', label: 'Forms', icon: 'doc', blurb: 'Forms and surveys', products: ['forms'] },
    { id: 'scheduling', label: 'Scheduling', icon: 'calendar', blurb: 'Booking pages', products: ['scheduling'] },
    { id: 'analytics', label: 'Analytics', icon: 'chart', blurb: 'Dashboards', products: ['spectra'], work: ['Dashboards', [['Revenue', '€42k this month'], ['Support', '7 open']]] },
  ],
  dev: [
    { id: 'agents', label: 'Agents', icon: 'bot', blurb: 'Agent sessions and runs', products: ['agent', 'agent-cli', 'agent-sdk', 'acp', 'use'],
      work: ['Sessions', [['Refactor auth gate', 'Running', 'agent'], ['Fix flaky test', 'Waiting on you', 'agent'], ['Release notes', 'Done', 'agent']]] },
    { id: 'automate', label: 'Automate', icon: 'flow', blurb: 'Workflows and apps', products: ['workflow', 'apps'],
      work: ['Runs', [['Nightly asset sync', 'Done · 1 cr', 'workflow'], ['Weekly report', 'Mon 09:00', 'workflow'], ['Lead enrich', 'Failed', 'workflow']]] },
    { id: 'build', label: 'Build', icon: 'box', blurb: 'Engine, Shell and Spawn', products: ['engine', 'shell', 'spawn'] },
    { id: 'sdks', label: 'SDKs', icon: 'download', blurb: 'Runtimes and libraries', products: ['rt', 'lib'] },
  ],
  tools: [
    { id: 'image', label: 'Image', icon: 'spark', blurb: 'Image tools', products: ['tool-resize', 'tool-bg', 'tool-upscale'] },
    { id: 'video', label: 'Video', icon: 'film', blurb: 'Video tools', products: ['tool-trim'] },
    { id: 'audio', label: 'Audio', icon: 'play', blurb: 'Audio tools', products: ['tool-transcribe'] },
    { id: 'documents', label: 'Documents', icon: 'doc', blurb: 'Document tools', products: ['tool-pdfmerge'] },
    { id: 'data', label: 'Data', icon: 'grid', blurb: 'Data tools', products: ['tool-csv'] },
    { id: 'developer', label: 'Developer', icon: 'box', blurb: 'Developer tools', products: ['tool-json'] },
  ],
};
window.XENO_BADGES = { 'social.publish': 2, 'social.message': 1, 'dev.agents': 'live', 'dev.automate': 'live', 'studio.create': 'live', 'overview.activity': 4 };

// ── Product panels: each product's OWN sidebar, the one it has standalone (nouns from its repo).
//    primary = the create verb; sections = [title, rows]. Products without an entry get the
//    honest default (recent work + open/notify) — never an invented nav.
window.XENO_PRODUCT_NAV = {
  post: { primary: 'New post', views: ['Calendar', 'Queue', 'Drafts', 'Inbox', 'Analytics'], sections: [['Channels', [['X · @xenosystem', 'Connected'], ['LinkedIn · XENOSYSTEM', 'Connected'], ['Instagram · knowtechglobal', 'Connected']]], ['Needs approval', [['Launch week thread', 'Today 18:00'], ['Behind the scenes reel', 'Tomorrow']]]] },
  comms: { primary: 'New message', views: ['Inbox', 'Mentions', 'Calls'], sections: [['Channels', [['# design', '3'], ['# launch', ''], ['# random', '']]], ['Direct messages', [['Nova', '1'], ['Atlas (agent)', ''], ['Mira', '']]]] },
  agent: { primary: 'New session', views: ['Sessions', 'Runs', 'Checkpoints'], sections: [['Workspaces', [['xeno-platform', '3 sessions'], ['xeno-canvas', '1 session']]], ['Sessions', [['Refactor auth gate', 'Running'], ['Fix flaky test', 'Waiting on you'], ['Release notes', 'Done']]]] },
  workflow: { primary: 'New workflow', views: ['Workflows', 'Runs', 'Connections', 'Templates'], sections: [['Workflows', [['Nightly asset sync', 'Daily 02:00'], ['Weekly report', 'Mon 09:00'], ['Lead enrich', 'On webhook']]]] },
  docs: { primary: 'New document', views: ['Recent', 'Shared with me', 'Starred'], sections: [['Folders', [['Planning', '6'], ['Hiring', '3'], ['Legal', '4']]]] },
  sheets: { primary: 'New sheet', views: ['Recent', 'Shared with me', 'Starred'], sections: [['Folders', [['Finance', '5'], ['Ops', '2']]]] },
  slides: { primary: 'New deck', views: ['Recent', 'Shared with me', 'Templates'], sections: [['Folders', [['Investors', '3'], ['All-hands', '8']]]] },
  notes: { primary: 'New page', views: ['Favorites', 'Recent'], sections: [['Pages', [['Product principles', ''], ['Meeting notes', '12'], ['Reading list', '']]]] },
  mail: { primary: 'Compose', views: ['Inbox', 'Starred', 'Sent', 'Drafts', 'Archive'], sections: [['Labels', [['Legal', '1'], ['Finance', ''], ['Agent-triaged', '6']]]] },
  canvas: { primary: 'New design file', views: ['Recent', 'Drafts', 'Shared with me'], sections: [['Projects', [['Brand refresh', '4 files'], ['Onboarding', '2 files']]], ['Libraries', [['XENO components', 'Team'], ['Icons', 'Team']]]] },
  image: { primary: 'New image', views: ['Library', 'Favorites'], sections: [['Projects', [['Launch visuals', '42'], ['Moodboards', '18']]]] },
  video: { primary: 'New video', views: ['Library', 'Favorites'], sections: [['Projects', [['Launch visuals', '6']]]] },
  audio: { primary: 'New audio', views: ['Library', 'Voices'], sections: [['Projects', [['Podcast', '12']]]] },
  '3d': { primary: 'New model', views: ['Library'], sections: [['Projects', [['Props', '9']]]] },
  company: { primary: 'Invite a member', views: ['Members', 'Agent workforce', 'Divisions', 'Wallet', 'Seller account'], sections: [['Divisions', [['Studio', '4 people · 2 agents'], ['Office', '2 people · 1 agent'], ['Dev', '3 people · 4 agents']]]] },
  seats: { primary: 'Invite', views: ['Members', 'Seats', 'Roles'] },
  community: { primary: 'New space', views: ['Feed', 'Spaces', 'Moderation'], sections: [['Spaces', [['Help & questions', 'Q&A'], ['Showcase', 'Showcase'], ['Announcements', 'Announcement']]]] },
};
// desktop apps: their nav lives in the app; the panel is a launcher into recent files + projects
window.XENO_DESKTOP_NAV = { views: ['Recent files', 'Projects'] };

// ── Globals (MODES §4): their real top level. Community = XENO's own forum (FORUM SPEC §2.1:
//    Spaces by kind, the Record + your Feed). Marketplace = two storefront modes (MARKETPLACE §14).
window.XENO_GLOBAL_NAV = {
  // the full notification inbox — the bell's 'View all'; one item per view, each with its own address
  inbox: ['Inbox', 'All modes', 'Mark all read', [['Views', [['Inbox', ''], ['Snoozed', ''], ['Archived', '']]]]],
  // ONE project object (WORKFORCE §8.5 goal · milestone · task + chat-projects context boundary)
  projects: ['Projects', 'All modes', 'New project', [['Active', [['Brand refresh', 'Studio · 4 tasks'], ['Q4 planning', 'Office · 2 tasks'], ['Launch week', 'Social · due Fri'], ['Auth gate', 'Dev · in review'], ['XENO launch', '2 chats']]], ['Shared with me', [['Partner co-marketing', 'Social'], ['Home reno', 'Personal']]], ['Archive', [['Archived projects', '7']]]]],
  // WORKFORCE §11.2 workspace scope, administered rather than visited — one entry, these views
  workspace: ['Workspace', 'XENO Corp', 'Invite people or agents', [['Manage', [['Members', '9 people · 7 agents'], ['Agents', '7 assigned'], ['Teams', '3'], ['Knowledge', '128 sources'], ['Automations', '12 active'], ['Activity', '4 new'], ['Settings', ''], ['Company', 'Legal, wallet, seats']]], ['Divisions', [['Studio', '4 people · 2 agents'], ['Office', '2 people · 1 agent'], ['Social', '1 person · 2 agents'], ['Dev', '3 people · 4 agents']]], ['Across all workspaces', [['All my agents', '9 · 2 rented'], ['All my teams', '4'], ['Switch workspace', '3 workspaces']]]]],
  // account-wide: every product writes here; filters are views, not separate libraries
  library: ['Library', 'All your files', 'Upload', [['Browse', [['All files', '2,184'], ['Images', '1,240'], ['Video', '86'], ['Audio', '41'], ['Documents', '312'], ['Code & artifacts', '505']]], ['From', [['From chats', '418'], ['Studio', '1,102'], ['Office', '296'], ['Social', '211'], ['Dev', '157']]], ['Yours', [['Starred', '24'], ['Shared with me', '9'], ['Trash', '']]]]],
  places: ['Places', 'Your workspace as a building', null, [['Building', [['All floors', ''], ['Lobby', '']]]]],
  anima: ['Anima', 'Your agent', 'New chat with Anima', [['Minds', [['Atlas — research', 'Running'], ['Juno — inbox', 'Idle'], ['Kit — code review', 'Idle']]], ['Soul', [['Memory', '1,204 episodes'], ['Skills it learned', '17']]], ['Together', [['Swarms', '1']]], ['Chats', [['Plan the offsite', 'Today'], ['Summarise my week', 'Mon']]]]],
  community: ['Community', 'Forum', 'New thread', [['Your feed', [['For you', ''], ['Following', '3 new'], ['My threads', '2 replies']]], ['Spaces', [['Questions', ''], ['Discussions', ''], ['Showcase', ''], ['Feedback', ''], ['Announcements', '']]], ['Report', [['Report a problem', 'F1'], ['My reports', ''], ['Moderation', '']]]]],
  market: ['Marketplace', 'Store', 'Browse', [['Apps', [['All apps', ''], ['Tools', ''], ['Blocks', ''], ['Plugins & MCP', ''], ['Blueprints', '']]], ['Agents', [['All agents', ''], ['Minds', ''], ['Teams', ''], ['Models', '']]], ['Yours', [['Purchases', '2'], ['Rentals', '1'], ['Seller console', '']]]]],
};

// ── Chat keeps ONE history per context: a chat started in Studio stays in Studio, Overview's
//    chats are the cross-mode ones. Same panel shape everywhere (projects · pinned · recents).
window.XENO_CHATS_BY_CTX = {
  overview: { projects: [['XENO launch', true, ['YC application draft', 'Pricing page copy']], ['Home reno', false, ['Kitchen budget']]], pinned: ['Weekly planning template'], recents: [['Today', ['Plan my week across modes', 'YC application draft']], ['Yesterday', ['Translate email to German']]] },
  studio: { projects: [['Brand refresh', true, ['Homepage hero ideas', 'Colour palette options']], ['Launch trailer', false, ['Shot list v2']]], pinned: ['Moodboard prompts'], recents: [['Today', ['Homepage hero ideas', 'Neon city prompt tweaks']], ['Yesterday', ['Trailer voice-over script']]] },
  office: { projects: [['Q4 planning', true, ['Board memo draft', 'OKR wording']], ['Hiring', false, ['Job post — designer']]], pinned: ['Meeting notes template'], recents: [['Today', ['Board memo draft', 'Budget formula help']], ['Yesterday', ['Reply to legal']]] },
  social: { projects: [['Launch week', true, ['Thread hooks', 'Reel captions']]], pinned: ['Brand voice'], recents: [['Today', ['Thread hooks', 'Reply to @nova']], ['Yesterday', ['Newsletter #14 outline']]] },
  corpo: { projects: [['Company setup', true, ['Division structure', 'Agent hiring plan']]], pinned: ['Pricing policy'], recents: [['Today', ['Agent hiring plan']], ['Yesterday', ['Invoice #2041 follow-up']]] },
  dev: { projects: [['Auth gate', true, ['Token refresh bug', 'Test plan']], ['Nightly sync', false, ['Cron schedule']]], pinned: ['Repo conventions'], recents: [['Today', ['Token refresh bug', 'Regex for semver']], ['Yesterday', ['Workflow webhook payload']]] },
  tools: { projects: [], pinned: [], recents: [['Today', ['Best size for a LinkedIn banner']]] },
};

// ── Projects (WORKFORCE §8.5: goal · milestone · task; §11.2 tabs). One object: chats, files, tasks
//    and the teams assigned to it. Teams are REFERENCED, never copied under each project (§11.2).
window.XENO_PROJECT_TABS = ['Overview', 'Tasks', 'Conversations', 'Team assignments', 'Resources', 'Funding', 'Activity'];
window.XENO_PROJECTS = {
  'Brand refresh': { mode: 'Studio', owner: 'Emilian', goal: 'Ship the new brand across site, app and social by Oct 31.', milestone: 'Homepage hero approved', progress: '4 of 9 tasks',
    tasks: [['Homepage hero', 'In review · Atlas'], ['Logo lockups', 'Done'], ['Colour tokens', 'In progress · Emilian'], ['Social templates', 'To do']],
    chats: [['Homepage hero ideas', 'Chat · Studio'], ['Colour palette options', 'Chat · Studio'], ['Hero render pass', 'Agent · xeno-canvas']],
    teams: [['Design', '3 people · 1 agent'], ['Atlas (agent)', 'Research']], resources: [['Brand refresh — homepage', 'Canvas file'], ['XENO brand kit', 'Library · 214 assets'], ['Launch moodboard', 'Library · 38 assets']],
    funding: [['Budget', '€2,400 of €4,000'], ['Agent runs this month', '312 credits']], activity: [['Atlas moved "Homepage hero" to review', '12 min'], ['Emilian added 3 files', '2 h'], ['Design team assigned', 'Mon']] },
  'Q4 planning': { mode: 'Office', owner: 'Emilian', goal: 'Agree Q4 goals and budget with the board.', milestone: 'Board memo sent', progress: '2 of 5 tasks',
    tasks: [['Board memo draft', 'In progress'], ['Budget 2027', 'In review'], ['OKR wording', 'To do']], chats: [['Board memo draft', 'Chat · Office'], ['OKR wording', 'Chat · Office']],
    teams: [['Leadership', '2 people']], resources: [['Q4 planning', 'Docs'], ['Budget 2027', 'Sheets']], funding: [], activity: [['Budget 2027 edited', '3 h']] },
  'Launch week': { mode: 'Social', owner: 'Emilian', goal: 'Announce the platform across every channel in one week.', milestone: 'Launch thread live', progress: 'due Fri',
    tasks: [['Launch thread', 'Scheduled Today 18:00'], ['Behind the scenes reel', 'Needs approval'], ['Newsletter #14', 'Draft']], chats: [['Thread hooks', 'Chat · Social'], ['Reel captions', 'Chat · Social']],
    teams: [['Growth', '2 people · 2 agents']], resources: [['Launch week thread', 'Post'], ['Newsletter #14', 'Audience']], funding: [['Ad spend', '€600 of €1,500']], activity: [['2 posts waiting for approval', '20 min']] },
  'Auth gate': { mode: 'Dev', owner: 'Emilian', goal: 'Every app refuses unapproved builds at the token endpoint.', milestone: 'Canvas gated', progress: 'in review',
    tasks: [['Token refresh bug', 'In progress · Kit'], ['Test plan', 'Done'], ['Floor rows per product', 'To do']], chats: [['Token refresh bug', 'Chat · Dev'], ['Refactor auth gate', 'Agent · xeno-platform']],
    teams: [['Platform', '4 people · 3 agents'], ['Kit (agent)', 'Code review']], resources: [['xeno-platform', 'Repository'], ['Auth gate delta', 'Doc']], funding: [], activity: [['Kit asked a question in "Fix flaky test"', '1 h']] },
  'XENO launch': { mode: 'Overview', owner: 'Emilian', goal: 'YC application and public launch.', milestone: 'Application submitted', progress: '2 chats',
    tasks: [['YC application', 'In progress']], chats: [['YC application draft', 'Chat · Overview'], ['Pricing page copy', 'Chat · Overview']], teams: [], resources: [['YC application draft', 'Docs']], funding: [], activity: [['YC application draft edited', 'Today']] },
};

// ── Overview = the union: the main areas of every mode, on one rail (grouped by mode). Ids are
//    "<mode>-<zone>"; the zone object is the mode's own, so content can never diverge.
window.XENO_OVERVIEW_MAIN = { studio: ['create'], office: ['write'], social: ['publish'], corpo: ['company'], dev: ['agents'], tools: ['image'] };  // ONE main area per mode — six icons fit every screen; the rest is one click away (Open <mode> mode)
// every area of every mode is addressable from Overview; the rail shows them grouped under their mode
window.XENO_MODE_ZONES.overview = ['studio', 'office', 'social', 'corpo', 'dev', 'tools'].flatMap((m) => window.XENO_MODE_ZONES[m].map((z) => ({ ...z, id: m + '-' + z.id, of: m })));
Object.entries({ ...window.XENO_BADGES }).forEach(([k, v]) => { const [m, z] = k.split('.'); if (m !== 'overview') window.XENO_BADGES['overview.' + m + '-' + z] = v; });
