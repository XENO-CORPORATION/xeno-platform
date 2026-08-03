/**
 * Chat LLM skills libraries.
 *
 * - Global (account Settings): Create / Add / Import → account catalog of skills.
 * - Chat Customize: Library = skills installed on this chat only; Add = account
 *   globals + marketplace catalog to install into this chat; then On/Off.
 */

export type LibrarySkillSource = 'built_in' | 'created' | 'catalog' | 'imported';

export type SkillVisibility = 'global' | 'chat';

export type LibrarySkill = {
  id: string;
  name: string;
  summary: string;
  /** Full skill body (instructions). */
  body: string;
  author: string;
  source: LibrarySkillSource;
  /** global = account library; chat = only one conversation. */
  visibility: SkillVisibility;
  /**
   * When visibility === 'chat': conversation id, or PENDING_CHAT_SKILLS_SCOPE
   * for the New chat draft. Null when global.
   */
  conversationId: string | null;
  /** If cloned into a chat from a global or catalog row, the source id. */
  originId: string | null;
  createdAt: number;
  updatedAt: number;
};

/** Row for UI lists — includes effective On/Off for a chat scope. */
export type ChatSkillRow = LibrarySkill & {
  enabled: boolean;
};

export type CreateLibrarySkillInput = {
  name: string;
  summary: string;
  body: string;
  visibility: SkillVisibility;
  /** Required when visibility === 'chat' (null = New chat draft). */
  conversationId?: string | null;
};

export type ImportLibrarySkillInput = {
  name: string;
  summary?: string;
  body: string;
  /** e.g. "claude" | "agentskills" | "file" */
  platform: string;
  visibility: SkillVisibility;
  conversationId?: string | null;
};

export type CatalogSkill = {
  id: string;
  name: string;
  summary: string;
  body: string;
  author: string;
  category: SkillCategoryId;
};

/** Max skills shown on one Add leaf screen (zero scroll, no pagination). */
export const MAX_ADD_LEAF_SKILLS = 12;

export type SkillCategoryId =
  | 'communication'
  | 'treatment'
  | 'logistics'
  | 'lab'
  | 'materials'
  | 'studio'
  | 'general';

export const SKILL_CATEGORY_LABEL: Record<SkillCategoryId, string> = {
  communication: 'Communication',
  treatment: 'Treatment',
  logistics: 'Logistics',
  lab: 'Lab & analysis',
  materials: 'Materials',
  studio: 'Studio ops',
  general: 'General',
};

/** Browse order inside Global / Catalog. */
export const SKILL_CATEGORY_ORDER: SkillCategoryId[] = [
  'communication',
  'treatment',
  'logistics',
  'lab',
  'materials',
  'studio',
  'general',
];

/**
 * Category for each mock skill id. Leaf groups must stay ≤ MAX_ADD_LEAF_SKILLS
 * so Add can drill down without scroll or pagination.
 */
const SKILL_CATEGORY_BY_ID: Record<string, SkillCategoryId> = {
  'skill-condition-report': 'treatment',
  'skill-client-email': 'communication',
  'skill-palette-extract': 'treatment',
  'skill-loan-pack': 'logistics',
  'skill-photo-set': 'logistics',
  'skill-estimate-scope': 'treatment',
  'skill-storage-move': 'logistics',
  'skill-meeting-minutes': 'communication',
  'skill-label-copy': 'communication',
  'skill-vendor-brief': 'communication',
  'skill-insurance-claim': 'logistics',
  'skill-treatment-proposal': 'treatment',
  'skill-mount-spec': 'treatment',
  'skill-courier-brief': 'logistics',
  'skill-inventory-diff': 'logistics',
  'skill-solvent-plan': 'treatment',
  'skill-donor-update': 'communication',
  'skill-frame-assessment': 'treatment',
  'skill-sample-log': 'treatment',
  'skill-exhibit-schedule': 'logistics',
  'skill-light-budget': 'logistics',
  'skill-pest-trap-log': 'logistics',
  'skill-access-request': 'communication',
  'catalog-lab-checklist': 'lab',
  'catalog-treatment-risk': 'lab',
  'catalog-packing-spec': 'studio',
  'catalog-climate-log': 'lab',
  'catalog-bid-response': 'studio',
  'catalog-ethics-check': 'lab',
  'catalog-material-id': 'lab',
  'catalog-press-blurb': 'studio',
  'catalog-uv-exam': 'lab',
  'catalog-xray-brief': 'lab',
  'catalog-varnish-options': 'materials',
  'catalog-tear-mending': 'materials',
  'catalog-gilding-touch': 'materials',
  'catalog-textile-clean': 'materials',
  'catalog-metal-corrosion': 'materials',
  'catalog-stone-desalt': 'materials',
  'catalog-wood-pest': 'materials',
  'catalog-photo-rights': 'studio',
  'catalog-grant-snippet': 'studio',
  'catalog-training-drill': 'studio',
  'catalog-incident-report': 'studio',
  'catalog-storage-audit': 'studio',
  // Customize dialog mock skills (layout demo when a chat has none installed)
  'mock-customize-intake': 'logistics',
  'mock-customize-condition': 'treatment',
  'mock-customize-glossary': 'communication',
  'mock-customize-timeline': 'studio',
  'mock-customize-qc': 'lab',
  'mock-customize-handoff': 'communication',
  'mock-customize-solvent': 'materials',
  'mock-customize-packing': 'logistics',
  'mock-customize-email': 'communication',
  'mock-customize-estimate': 'treatment',
};

export const resolveSkillCategory = (id: string): SkillCategoryId =>
  SKILL_CATEGORY_BY_ID[id] ?? 'general';


const day = 24 * 60 * 60 * 1000;
const now = Date.now();

export const PENDING_CHAT_SKILLS_SCOPE = 'pending-new-chat';

const randomId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `skill-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  }
  return `skill-${Date.now().toString(36)}`;
};

const resolveChatScope = (conversationId: string | null | undefined): string =>
  conversationId?.trim() ? conversationId : PENDING_CHAT_SKILLS_SCOPE;

/** Seed: account Global skills (install into a chat via Add). */
let libraryStore: LibrarySkill[] = [
  {
    id: 'skill-condition-report',
    name: 'Condition report',
    summary: 'Structured outline for object condition notes',
    body:
      'When the user asks for a condition report, produce: 1) Object ID 2) Materials 3) Condition summary 4) Proposed treatment 5) Risks. Ask before irreversible steps.',
    author: 'XENO',
    source: 'built_in',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 30 * day,
    updatedAt: now - 3 * day,
  },
  {
    id: 'skill-client-email',
    name: 'Client email',
    summary: 'Calm progress updates for clients',
    body:
      'Draft short, calm client emails. No jargon. State what was done, what needs approval, and next steps. Reversible language only.',
    author: 'XENO',
    source: 'built_in',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 30 * day,
    updatedAt: now - 8 * day,
  },
  {
    id: 'skill-palette-extract',
    name: 'Palette extract',
    summary: 'Map pigments to plain swatch notes',
    body:
      'Extract a small palette from descriptions or images. Name pigments plainly, include approximate hex when useful, keep notes short.',
    author: 'Studio',
    source: 'catalog',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 20 * day,
    updatedAt: now - 20 * day,
  },
  {
    id: 'skill-loan-pack',
    name: 'Loan pack',
    summary: 'Outgoing loan checklist and cover note',
    body:
      'Build a loan-out pack: object list, condition summary, packing notes, courier constraints, and a short cover email. Flag missing insurance values.',
    author: 'XENO',
    source: 'built_in',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 18 * day,
    updatedAt: now - 4 * day,
  },
  {
    id: 'skill-photo-set',
    name: 'Photo set brief',
    summary: 'Shot list for documentation photos',
    body:
      'Write a documentation photo brief: overall, details, raking light, labels, scale. Note file naming and colour target.',
    author: 'Studio',
    source: 'created',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 16 * day,
    updatedAt: now - 2 * day,
  },
  {
    id: 'skill-estimate-scope',
    name: 'Estimate scope',
    summary: 'Time and cost outline for a treatment',
    body:
      'Draft a treatment estimate: phases, hours, materials, contingencies. Separate optional vs required work. Plain language for the client.',
    author: 'XENO',
    source: 'built_in',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 14 * day,
    updatedAt: now - 1 * day,
  },
  {
    id: 'skill-storage-move',
    name: 'Storage move plan',
    summary: 'Step plan for relocating objects safely',
    body:
      'Plan a storage move: sequence, packing, handlers, destination conditions, and a short risk list. Prefer reversible packing.',
    author: 'Studio',
    source: 'created',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 12 * day,
    updatedAt: now - 5 * day,
  },
  {
    id: 'skill-meeting-minutes',
    name: 'Meeting minutes',
    summary: 'Dated bullets with decisions and owners',
    body:
      'Turn notes into dated minutes: decisions, owners, deadlines. No fluff. Call out open questions.',
    author: 'XENO',
    source: 'built_in',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 11 * day,
    updatedAt: now - 6 * day,
  },
  {
    id: 'skill-label-copy',
    name: 'Label copy',
    summary: 'Wall or object labels in plain English',
    body:
      'Write short exhibition or object labels: title, maker, date, materials, one accessible sentence. Avoid jargon.',
    author: 'Studio',
    source: 'catalog',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 10 * day,
    updatedAt: now - 7 * day,
  },
  {
    id: 'skill-vendor-brief',
    name: 'Vendor brief',
    summary: 'Brief for framers, shippers, or labs',
    body:
      'Write a vendor brief: deliverable, constraints, materials, deadlines, and acceptance criteria. Ask before irreversible steps.',
    author: 'XENO',
    source: 'created',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 9 * day,
    updatedAt: now - 2 * day,
  },
  {
    id: 'skill-insurance-claim',
    name: 'Insurance claim note',
    summary: 'Factual damage note for insurers',
    body:
      'Draft a factual insurance note: object ID, observed damage, likely cause if known, photos list. No blame language.',
    author: 'XENO',
    source: 'built_in',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 8 * day,
    updatedAt: now - 1 * day,
  },
  {
    id: 'skill-treatment-proposal',
    name: 'Treatment proposal',
    summary: 'Client-facing treatment options memo',
    body:
      'Write a short treatment proposal with options A/B, risks, time, and cost bands. Recommend one, explain why.',
    author: 'Studio',
    source: 'created',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 8 * day,
    updatedAt: now - 3 * day,
  },
  {
    id: 'skill-mount-spec',
    name: 'Mount specification',
    summary: 'Display mount materials and method',
    body:
      'Specify a display mount: materials, contact points, load path, and how to reverse it. Prefer inert materials.',
    author: 'XENO',
    source: 'built_in',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 7 * day,
    updatedAt: now - 2 * day,
  },
  {
    id: 'skill-courier-brief',
    name: 'Courier brief',
    summary: 'Hand-carry instructions for a courier',
    body:
      'Write courier hand-carry notes: orientation, climate, do-not-stack, emergency contacts. Keep under one page.',
    author: 'Studio',
    source: 'catalog',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 7 * day,
    updatedAt: now - 4 * day,
  },
  {
    id: 'skill-inventory-diff',
    name: 'Inventory diff',
    summary: 'Compare two inventory lists',
    body:
      'Diff two object lists: added, missing, moved, status changes. Output a short table and open questions.',
    author: 'XENO',
    source: 'created',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 6 * day,
    updatedAt: now - 1 * day,
  },
  {
    id: 'skill-solvent-plan',
    name: 'Solvent test plan',
    summary: 'Ordered solubility test sequence',
    body:
      'Propose a solubility test ladder from mild to strong. Log each result. Stop and ask before any cleaning pass.',
    author: 'Studio',
    source: 'built_in',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 6 * day,
    updatedAt: now - 2 * day,
  },
  {
    id: 'skill-donor-update',
    name: 'Donor update',
    summary: 'Warm progress note for a donor',
    body:
      'Draft a warm, short donor update: what was done, what remains, one concrete detail. No jargon, no ask unless requested.',
    author: 'XENO',
    source: 'created',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 5 * day,
    updatedAt: now - 1 * day,
  },
  {
    id: 'skill-frame-assessment',
    name: 'Frame assessment',
    summary: 'Frame condition and options note',
    body:
      'Assess a frame: structure, finish, fit, risks to the artwork. Offer keep / repair / replace with trade-offs.',
    author: 'Studio',
    source: 'catalog',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 5 * day,
    updatedAt: now - 3 * day,
  },
  {
    id: 'skill-sample-log',
    name: 'Sample log',
    summary: 'Register analytical samples taken',
    body:
      'Log samples: ID, location on object, method, quantity, storage, chain of custody. Ask before destructive sampling.',
    author: 'XENO',
    source: 'built_in',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 4 * day,
    updatedAt: now - 1 * day,
  },
  {
    id: 'skill-exhibit-schedule',
    name: 'Exhibit schedule',
    summary: 'Install / deinstall day plan',
    body:
      'Build an install day schedule: call times, roles, object order, buffer for surprises. Flag dependencies.',
    author: 'Studio',
    source: 'created',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 4 * day,
    updatedAt: now - 2 * day,
  },
  {
    id: 'skill-light-budget',
    name: 'Light budget',
    summary: 'Lux-hours plan for display',
    body:
      'Propose a light budget: lux target, hours open, annual lux-hours, and rotation if needed. Cite material sensitivity plainly.',
    author: 'XENO',
    source: 'built_in',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 3 * day,
    updatedAt: now - 1 * day,
  },
  {
    id: 'skill-pest-trap-log',
    name: 'Pest trap log',
    summary: 'Summarize IPM trap findings',
    body:
      'Summarize pest trap data: locations, counts, species if known, actions. Escalate if active infestation signs.',
    author: 'Studio',
    source: 'imported',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 3 * day,
    updatedAt: now - 12 * 60 * 60 * 1000,
  },
  {
    id: 'skill-access-request',
    name: 'Access request',
    summary: 'Studio visit request reply',
    body:
      'Reply to a studio access request: available slots, PPE, photography rules, escort needed. Confirm before booking.',
    author: 'XENO',
    source: 'created',
    visibility: 'global',
    conversationId: null,
    originId: null,
    createdAt: now - 2 * day,
    updatedAt: now - 6 * 60 * 60 * 1000,
  },
  // Mock chat-local skills on the New chat draft — so Library pagination is visible.
  {
    id: 'skill-draft-intake',
    name: 'Intake form helper',
    summary: 'Questions for a new object intake',
    body:
      'Ask intake questions in order: owner, object ID, materials, prior treatment, urgency. Keep a checklist tone.',
    author: 'You',
    source: 'created',
    visibility: 'chat',
    conversationId: PENDING_CHAT_SKILLS_SCOPE,
    originId: null,
    createdAt: now - 2 * day,
    updatedAt: now - 2 * day,
  },
  {
    id: 'skill-draft-gloss',
    name: 'Glossary builder',
    summary: 'Define terms for a client pack',
    body:
      'Build a short glossary of conservation terms used in this chat. One plain sentence each.',
    author: 'You',
    source: 'created',
    visibility: 'chat',
    conversationId: PENDING_CHAT_SKILLS_SCOPE,
    originId: null,
    createdAt: now - 2 * day,
    updatedAt: now - 1 * day,
  },
  {
    id: 'skill-draft-timeline',
    name: 'Project timeline',
    summary: 'Phased timeline for the open job',
    body:
      'Propose a phased timeline with milestones and review points. Mark what needs client approval.',
    author: 'You',
    source: 'created',
    visibility: 'chat',
    conversationId: PENDING_CHAT_SKILLS_SCOPE,
    originId: null,
    createdAt: now - 1 * day,
    updatedAt: now - 1 * day,
  },
  {
    id: 'skill-draft-qc',
    name: 'QC pass',
    summary: 'Final quality checklist before handoff',
    body:
      'Run a QC checklist: photos, report complete, packing, labels, open risks. List blockers only.',
    author: 'You',
    source: 'imported',
    visibility: 'chat',
    conversationId: PENDING_CHAT_SKILLS_SCOPE,
    originId: null,
    createdAt: now - 1 * day,
    updatedAt: now - 12 * 60 * 60 * 1000,
  },
  {
    id: 'skill-draft-cite',
    name: 'Citation scrub',
    summary: 'Normalize references in notes',
    body:
      'Normalize citations in studio notes to a consistent short form. Flag incomplete sources.',
    author: 'You',
    source: 'created',
    visibility: 'chat',
    conversationId: PENDING_CHAT_SKILLS_SCOPE,
    originId: null,
    createdAt: now - 20 * 60 * 60 * 1000,
    updatedAt: now - 8 * 60 * 60 * 1000,
  },
  {
    id: 'skill-draft-handoff',
    name: 'Handoff note',
    summary: 'Shift handoff for the next conservator',
    body:
      'Write a handoff: status, open risks, where files live, next action. Keep it under one screen.',
    author: 'You',
    source: 'created',
    visibility: 'chat',
    conversationId: PENDING_CHAT_SKILLS_SCOPE,
    originId: null,
    createdAt: now - 6 * 60 * 60 * 1000,
    updatedAt: now - 3 * 60 * 60 * 1000,
  },
];

const catalogStore: Array<Omit<CatalogSkill, 'category'>> = [
  {
    id: 'catalog-lab-checklist',
    name: 'Lab checklist',
    summary: 'Weekly studio humidity / light / solvents pass',
    body: 'Produce a weekly lab checklist: humidity, light, solvent cabinet, open reports. Flag anything overdue.',
    author: 'XENO',
  },
  {
    id: 'catalog-treatment-risk',
    name: 'Treatment risk note',
    summary: 'Short risk register for a proposed treatment',
    body: 'List treatment risks in a short table: risk, likelihood, mitigation, reversibility. Ask before recommending.',
    author: 'XENO',
  },
  {
    id: 'catalog-packing-spec',
    name: 'Packing spec',
    summary: 'Crate and cushioning specification',
    body: 'Write a packing specification: materials, orientation, shock limits, labels. Prefer reversible methods.',
    author: 'Studio',
  },
  {
    id: 'catalog-climate-log',
    name: 'Climate log summary',
    summary: 'Summarize logger data for a case',
    body: 'Summarize climate logger data: range, spikes, and whether the environment is acceptable for the materials.',
    author: 'XENO',
  },
  {
    id: 'catalog-bid-response',
    name: 'Bid response',
    summary: 'Short reply to an RFP or quote request',
    body: 'Draft a calm bid response: scope, exclusions, timeline, and next step. No hard sell.',
    author: 'Studio',
  },
  {
    id: 'catalog-ethics-check',
    name: 'Ethics check',
    summary: 'Flag irreversible or contested steps',
    body: 'Review a proposed treatment for ethics risks: reversibility, documentation, consent. Ask before proceeding.',
    author: 'XENO',
  },
  {
    id: 'catalog-material-id',
    name: 'Material ID prompts',
    summary: 'Questions to narrow material identity',
    body: 'Ask structured questions to narrow material identity. Separate known facts from hypotheses.',
    author: 'Studio',
  },
  {
    id: 'catalog-press-blurb',
    name: 'Press blurb',
    summary: '120-word project blurb for press',
    body: 'Write a 120-word press blurb: what, why it matters, one concrete detail. No jargon.',
    author: 'XENO',
  },
  {
    id: 'catalog-uv-exam',
    name: 'UV exam notes',
    summary: 'Structure UV observation notes',
    body: 'Structure UV exam notes: wavelength, findings, photo refs, hypotheses vs facts.',
    author: 'Studio',
  },
  {
    id: 'catalog-xray-brief',
    name: 'X-ray brief',
    summary: 'Request sheet for radiographic imaging',
    body: 'Write an imaging request: object, views needed, sensitivity, handling limits, deliverable format.',
    author: 'XENO',
  },
  {
    id: 'catalog-varnish-options',
    name: 'Varnish options',
    summary: 'Compare varnish choices plainly',
    body: 'Compare varnish options: look, removability, yellowing risk, application. Recommend one with reasons.',
    author: 'Studio',
  },
  {
    id: 'catalog-tear-mending',
    name: 'Tear mending plan',
    summary: 'Step plan for a paper or canvas tear',
    body: 'Plan tear mending steps: stabilize, align, support, tone. Mark irreversible points and ask first.',
    author: 'XENO',
  },
  {
    id: 'catalog-gilding-touch',
    name: 'Gilding touch-up',
    summary: 'Limited gilding repair notes',
    body: 'Outline a limited gilding touch-up: surface prep, leaf/type, isolation, documentation. Prefer reversible fills.',
    author: 'Studio',
  },
  {
    id: 'catalog-textile-clean',
    name: 'Textile clean plan',
    summary: 'Dry / wet clean decision tree',
    body: 'Propose a textile cleaning path: tests, dry methods first, wet only if justified. Log each test.',
    author: 'XENO',
  },
  {
    id: 'catalog-metal-corrosion',
    name: 'Metal corrosion note',
    summary: 'Describe active vs stable corrosion',
    body: 'Describe corrosion: active vs stable, chloride risk if relevant, recommended holding environment.',
    author: 'Studio',
  },
  {
    id: 'catalog-stone-desalt',
    name: 'Stone desalination',
    summary: 'Poultices and monitoring outline',
    body: 'Outline desalination: poultice type, cycles, conductivity checks, stop criteria. Ask before starting.',
    author: 'XENO',
  },
  {
    id: 'catalog-wood-pest',
    name: 'Wood pest response',
    summary: 'IPM options for wood-borers',
    body: 'List IPM options for wood pests: monitor, isolate, treat. Prefer non-destructive first. Flag toxic methods.',
    author: 'Studio',
  },
  {
    id: 'catalog-photo-rights',
    name: 'Photo rights check',
    summary: 'Can we publish these images?',
    body: 'Check photo rights: owner, sitter, third-party marks, credit line. List what is safe to publish.',
    author: 'XENO',
  },
  {
    id: 'catalog-grant-snippet',
    name: 'Grant snippet',
    summary: '150-word grant impact paragraph',
    body: 'Write a 150-word grant impact paragraph: problem, method, outcome, public benefit. Concrete, not hype.',
    author: 'Studio',
  },
  {
    id: 'catalog-training-drill',
    name: 'Training drill',
    summary: 'Short staff drill for a procedure',
    body: 'Design a 20-minute staff drill for one studio procedure. Steps, roles, pass criteria.',
    author: 'XENO',
  },
  {
    id: 'catalog-incident-report',
    name: 'Incident report',
    summary: 'Studio incident write-up template',
    body: 'Write an incident report: when, what, people, damage, immediate actions, follow-up. Factual tone only.',
    author: 'Studio',
  },
  {
    id: 'catalog-storage-audit',
    name: 'Storage audit',
    summary: 'Walkthrough checklist for a bay',
    body: 'Produce a storage bay audit: overcrowding, climate, pests, labels, access paths. Prioritize fixes.',
    author: 'XENO',
  },
];

export type ListLibraryInput = {
  query?: string;
};

const matches = (text: string, query: string): boolean =>
  text.toLowerCase().includes(query.trim().toLowerCase());

const filterByQuery = (rows: LibrarySkill[], query: string): LibrarySkill[] => {
  if (!query.trim()) return rows;
  return rows.filter(
    (skill) =>
      matches(skill.name, query) ||
      matches(skill.summary, query) ||
      matches(skill.author, query) ||
      matches(skill.body, query),
  );
};

/** Backend: GET /api/chat/skills/library (Profile — global only). */
export const listLibrarySkills = async (
  input: ListLibraryInput = {},
): Promise<LibrarySkill[]> => {
  const rows = filterByQuery(
    libraryStore.filter((skill) => skill.visibility === 'global'),
    input.query ?? '',
  );
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
};

export type ListCatalogInput = ListLibraryInput & {
  /**
   * When listing catalog for a chat, hide names already installed on that chat.
   * When listing for global library, hide names already owned globally.
   */
  conversationId?: string | null;
  forVisibility?: SkillVisibility;
};

/** Backend: GET /api/chat/skills/catalog */
export const listCatalogSkills = async (
  input: ListCatalogInput = {},
): Promise<CatalogSkill[]> => {
  const q = input.query ?? '';
  const forChat = input.forVisibility === 'chat';
  const scope = forChat ? resolveChatScope(input.conversationId) : null;
  const owned = new Set(
    libraryStore
      .filter((skill) => {
        if (forChat && scope) {
          return (
            skill.visibility === 'chat' && skill.conversationId === scope
          );
        }
        return skill.visibility === 'global';
      })
      .map((skill) => skill.name.toLowerCase()),
  );
  let rows = catalogStore.filter((skill) => !owned.has(skill.name.toLowerCase()));
  if (q.trim()) {
    rows = rows.filter(
      (skill) =>
        matches(skill.name, q) ||
        matches(skill.summary, q) ||
        matches(skill.author, q),
    );
  }
  return rows.map((skill) => ({
    ...skill,
    category: resolveSkillCategory(skill.id),
  }));
};

const buildSkill = (
  partial: Omit<LibrarySkill, 'id' | 'createdAt' | 'updatedAt'> & {
    id?: string;
  },
): LibrarySkill => {
  const stamp = Date.now();
  return {
    id: partial.id ?? randomId(),
    name: partial.name,
    summary: partial.summary,
    body: partial.body,
    author: partial.author,
    source: partial.source,
    visibility: partial.visibility,
    conversationId: partial.conversationId,
    originId: partial.originId ?? null,
    createdAt: stamp,
    updatedAt: stamp,
  };
};

const resolveCreateScope = (
  visibility: SkillVisibility,
  conversationId?: string | null,
): string | null => {
  if (visibility === 'global') return null;
  return resolveChatScope(conversationId);
};

type ChatSkillOverrideMap = Record<string, boolean>;

/** conversation scope → skillId → enabled */
let chatSkillOverrides: Record<string, ChatSkillOverrideMap> = {};

/**
 * Effective On/Off for a chat.
 * Chat-local skills default On (installed / created for that chat).
 */
export const isSkillEnabledForChat = (
  conversationId: string | null | undefined,
  skillId: string,
): boolean => {
  const scope = resolveChatScope(conversationId);
  const override = chatSkillOverrides[scope]?.[skillId];
  if (override !== undefined) return override;
  const skill = libraryStore.find((row) => row.id === skillId);
  if (!skill) return false;
  return (
    skill.visibility === 'chat' && skill.conversationId === scope
  );
};

/** Backend: PATCH /api/chat/conversations/:id/skills/:skillId */
export const setChatSkillEnabled = async (
  conversationId: string | null | undefined,
  skillId: string,
  enabled: boolean,
): Promise<ChatSkillRow | null> => {
  const skill = libraryStore.find((row) => row.id === skillId);
  if (!skill || skill.visibility !== 'chat') return null;
  const scope = resolveChatScope(conversationId);
  if (skill.conversationId !== scope) return null;
  chatSkillOverrides = {
    ...chatSkillOverrides,
    [scope]: {
      ...(chatSkillOverrides[scope] ?? {}),
      [skillId]: enabled,
    },
  };
  return {
    ...skill,
    enabled,
    updatedAt: Date.now(),
  };
};

/** Backend: POST /api/chat/skills/library */
export const createLibrarySkill = async (
  input: CreateLibrarySkillInput,
): Promise<LibrarySkill> => {
  const skill = buildSkill({
    name: input.name.trim() || 'Untitled skill',
    summary: input.summary.trim(),
    body: input.body.trim(),
    author: 'You',
    source: 'created',
    visibility: input.visibility,
    conversationId: resolveCreateScope(input.visibility, input.conversationId),
    originId: null,
  });
  libraryStore = [skill, ...libraryStore];
  if (skill.visibility === 'chat' && skill.conversationId) {
    await setChatSkillEnabled(skill.conversationId, skill.id, true);
  }
  return skill;
};

/** Backend: POST /api/chat/skills/library/from-catalog */
export const addCatalogSkillToLibrary = async (
  catalogId: string,
  options: {
    visibility: SkillVisibility;
    conversationId?: string | null;
  },
): Promise<LibrarySkill | null> => {
  const catalog = catalogStore.find((item) => item.id === catalogId);
  if (!catalog) return null;
  const skill = buildSkill({
    name: catalog.name,
    summary: catalog.summary,
    body: catalog.body,
    author: catalog.author,
    source: 'catalog',
    visibility: options.visibility,
    conversationId: resolveCreateScope(
      options.visibility,
      options.conversationId,
    ),
    originId: catalog.id,
  });
  libraryStore = [skill, ...libraryStore];
  if (skill.visibility === 'chat' && skill.conversationId) {
    await setChatSkillEnabled(skill.conversationId, skill.id, true);
  }
  return skill;
};

/**
 * Backend: POST /api/chat/skills/import
 * Mock accepts pasted SKILL.md-style body (+ name).
 */
export const importLibrarySkill = async (
  input: ImportLibrarySkillInput,
): Promise<LibrarySkill> => {
  const skill = buildSkill({
    name: input.name.trim() || 'Imported skill',
    summary: (input.summary ?? `Imported from ${input.platform}`).trim(),
    body: input.body.trim(),
    author: 'Imported',
    source: 'imported',
    visibility: input.visibility,
    conversationId: resolveCreateScope(input.visibility, input.conversationId),
    originId: null,
  });
  libraryStore = [skill, ...libraryStore];
  if (skill.visibility === 'chat' && skill.conversationId) {
    await setChatSkillEnabled(skill.conversationId, skill.id, true);
  }
  return skill;
};

export type ListChatSkillsInput = ListLibraryInput & {
  /** null / undefined = New chat draft (pending scope). */
  conversationId?: string | null;
};

/** Skills installed on a chat (local only — not account globals). */
export const listChatSkills = async (
  input: ListChatSkillsInput = {},
): Promise<ChatSkillRow[]> => {
  const scope = resolveChatScope(input.conversationId);
  const visible = libraryStore.filter(
    (skill) =>
      skill.visibility === 'chat' && skill.conversationId === scope,
  );
  const rows = filterByQuery(visible, input.query ?? '');
  return rows
    .map((skill) => ({
      ...skill,
      enabled: isSkillEnabledForChat(input.conversationId, skill.id),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
};

export type AddableSkillKind = 'global' | 'catalog';

/** Row for Chat Customize → Add (account globals + marketplace not yet on this chat). */
export type AddableSkill = {
  id: string;
  name: string;
  summary: string;
  author: string;
  kind: AddableSkillKind;
  category: SkillCategoryId;
};

const chatOwnsSkill = (scope: string, originId: string, name: string): boolean =>
  libraryStore.some(
    (skill) =>
      skill.visibility === 'chat' &&
      skill.conversationId === scope &&
      (skill.originId === originId ||
        skill.name.toLowerCase() === name.toLowerCase()),
  );

/**
 * Backend: GET /api/chat/conversations/:id/skills/addable
 * Account globals + catalog entries not yet installed on this chat.
 */
export const listAddableSkillsForChat = async (
  input: ListChatSkillsInput = {},
): Promise<AddableSkill[]> => {
  const scope = resolveChatScope(input.conversationId);
  const q = input.query ?? '';
  const globals: AddableSkill[] = libraryStore
    .filter(
      (skill) =>
        skill.visibility === 'global' &&
        !chatOwnsSkill(scope, skill.id, skill.name),
    )
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      summary: skill.summary,
      author: skill.author,
      kind: 'global' as const,
      category: resolveSkillCategory(skill.id),
    }));
  const catalog = await listCatalogSkills({
    query: '',
    forVisibility: 'chat',
    conversationId: input.conversationId,
  });
  const catalogRows: AddableSkill[] = catalog.map((item) => ({
    id: item.id,
    name: item.name,
    summary: item.summary,
    author: item.author,
    kind: 'catalog' as const,
    category: item.category,
  }));
  let rows = [...globals, ...catalogRows];
  if (q.trim()) {
    rows = rows.filter(
      (skill) =>
        matches(skill.name, q) ||
        matches(skill.summary, q) ||
        matches(skill.author, q),
    );
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
};

/** Backend: POST /api/chat/conversations/:id/skills/from-global */
export const addGlobalSkillToChat = async (
  globalSkillId: string,
  conversationId?: string | null,
): Promise<LibrarySkill | null> => {
  const global = libraryStore.find(
    (skill) => skill.id === globalSkillId && skill.visibility === 'global',
  );
  if (!global) return null;
  const scope = resolveChatScope(conversationId);
  if (chatOwnsSkill(scope, global.id, global.name)) return null;
  const skill = buildSkill({
    name: global.name,
    summary: global.summary,
    body: global.body,
    author: global.author,
    source: global.source,
    visibility: 'chat',
    conversationId: scope,
    originId: global.id,
  });
  libraryStore = [skill, ...libraryStore];
  await setChatSkillEnabled(scope, skill.id, true);
  return skill;
};

/**
 * Bind New-chat draft: move pending local skills + On/Off overrides
 * onto the real conversation id.
 */
export const bindPendingChatSkills = async (
  conversationId: string,
): Promise<void> => {
  libraryStore = libraryStore.map((skill) => {
    if (
      skill.visibility === 'chat' &&
      skill.conversationId === PENDING_CHAT_SKILLS_SCOPE
    ) {
      return { ...skill, conversationId, updatedAt: Date.now() };
    }
    return skill;
  });

  const pending = chatSkillOverrides[PENDING_CHAT_SKILLS_SCOPE];
  if (!pending || Object.keys(pending).length === 0) return;
  const { [PENDING_CHAT_SKILLS_SCOPE]: _removed, ...rest } = chatSkillOverrides;
  chatSkillOverrides = {
    ...rest,
    [conversationId]: {
      ...(rest[conversationId] ?? {}),
      ...pending,
    },
  };
};

/** Clear New-chat draft skills + toggles (e.g. user clicks New chat again). */
export const clearPendingChatSkills = async (): Promise<void> => {
  libraryStore = libraryStore.filter(
    (skill) =>
      !(
        skill.visibility === 'chat' &&
        skill.conversationId === PENDING_CHAT_SKILLS_SCOPE
      ),
  );
  if (!(PENDING_CHAT_SKILLS_SCOPE in chatSkillOverrides)) return;
  const { [PENDING_CHAT_SKILLS_SCOPE]: _removed, ...rest } = chatSkillOverrides;
  chatSkillOverrides = rest;
};

/** Backend: DELETE /api/chat/skills/library/:id */
export const deleteLibrarySkill = async (id: string): Promise<void> => {
  libraryStore = libraryStore.filter((skill) => skill.id !== id);
  chatSkillOverrides = Object.fromEntries(
    Object.entries(chatSkillOverrides).map(([scope, map]) => {
      const { [id]: _removed, ...rest } = map;
      return [scope, rest];
    }),
  );
};

/** Backend: GET /api/chat/skills/library/:id */
export const getLibrarySkill = async (
  id: string,
): Promise<LibrarySkill | null> =>
  libraryStore.find((skill) => skill.id === id) ?? null;

/** Chat profile stub for Chat LLM settings. Backend: GET/PUT /api/chat/profile */
export type ChatProfile = {
  displayName: string;
  /** Persona id from the shared catalog, or null = none. */
  defaultPersonaId: string | null;
  updatedAt: number;
};

let chatProfileStore: ChatProfile = {
  displayName: 'Andreia',
  defaultPersonaId: 'conservator',
  updatedAt: now - 1 * day,
};

export const getChatProfile = async (): Promise<ChatProfile> => ({
  ...chatProfileStore,
});

export const saveChatProfile = async (
  input: Partial<Pick<ChatProfile, 'displayName' | 'defaultPersonaId'>>,
): Promise<ChatProfile> => {
  chatProfileStore = {
    ...chatProfileStore,
    ...input,
    displayName:
      input.displayName !== undefined
        ? input.displayName.trim() || chatProfileStore.displayName
        : chatProfileStore.displayName,
    defaultPersonaId:
      input.defaultPersonaId !== undefined
        ? input.defaultPersonaId
        : chatProfileStore.defaultPersonaId,
    updatedAt: Date.now(),
  };
  return { ...chatProfileStore };
};
