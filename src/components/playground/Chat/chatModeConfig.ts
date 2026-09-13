export type ChatMode = 'chat' | 'research' | 'code' | 'agents';

export const CHAT_MODE_TABS: ReadonlyArray<{ id: ChatMode; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'research', label: 'Research' },
  { id: 'code', label: 'Code' },
  { id: 'agents', label: 'Agents' },
];

export const CHAT_MODE_PLACEHOLDERS: Readonly<Record<ChatMode, string>> = {
  chat: 'Ask XENO anything — plan, explain, or rewrite',
  research: 'Research a topic with cited web sources',
  code: 'Write, review, or debug code',
  agents: 'Choose an agent or describe the task',
};

export const AGENT_HUB_MOCK_ACTIONS = [
  { id: 'create-agent', label: 'Create Agent' },
  { id: 'my-agents', label: 'My Agents' },
  { id: 'agent-marketplace', label: 'Agent Marketplace' },
] as const;

export type AgentHubMockActionId = (typeof AGENT_HUB_MOCK_ACTIONS)[number]['id'];

export const CODE_MODE_SYSTEM_INSTRUCTION = [
  'You are operating in XENO Code mode.',
  'Prioritize correct, executable code; state important assumptions; preserve the user\'s constraints; and explain the key implementation decisions.',
  'Use fenced code blocks with accurate language labels. When reviewing code, identify bugs and risks before suggesting changes.',
  'Never claim that code was executed unless a tool result confirms it.',
].join(' ');

/**
 * What XENO is, and what this surface can actually do right now.
 *
 * ## The defect this fixes, from a real transcript (2026-09-13)
 *
 * Asked "can you search online?" in Chat mode, the model answered:
 *
 *   "In this conversation I don't have web search or browsing available — I can only draw on
 *    what I learned during training, which has a cutoff date…"
 *
 * 🔴 That is wrong about this product, and the model had no way to know it. XENO ships a full
 * web-context pipeline — enhanced query generation, cited sources, two research depths — and in
 * Chat mode the system prompt was EMPTY unless the user had saved one. So the model answered
 * from its own training defaults and denied a capability the product has.
 *
 * It is the honesty problem in reverse: not a model over-claiming, but under-claiming a real
 * feature, which reads to the user as the product being less than it is.
 *
 * ⚠️ Every line here is a promise the product must keep. Do not add a capability before it is
 * wired: an inaccurate capability statement is worse than none, because the model will
 * confidently offer something that then fails.
 */
export const XENO_IDENTITY = [
  'You are XENO, the assistant inside the XENO platform (xenostudio.ai).',
  'Answer as XENO about what THIS product can do — not about the capabilities of the model you run on.',
].join(' ');

/**
 * Search, stated per mode.
 *
 * ## The two tiers are SCALE, not on/off — checked against Anthropic, 2026-09-13
 *
 * A first draft of this called Research "the mode that always searches" and framed Chat and
 * Research as alternatives. That is the wrong model, and Anthropic's own help pages give the
 * real one:
 *
 *   web search — "one or two tool calls"; a quick lookup; a persistent setting
 *   Research   — "five or more tool calls over 1-3 minutes", "multiple sources across the web
 *                and your integrations", producing an "in-depth report" with citations
 *
 * 🔴 And they LAYER rather than exclude: "You must have web search turned on for research to
 * function." Research is a depth stacked on the search capability, not a different place where
 * search lives.
 *
 * ## ⚠️ THAT IS THE TARGET, NOT TODAY — corrected 2026-09-13 after a second transcript
 *
 * An earlier version of this text described the target as if it were the present: it told users
 * to enable search with "the search control beside the composer". There is no such control —
 * `toggleXenoSearch` and `toggleSearch` are both declared in ChatWithLLM.tsx and called by
 * NOTHING. The model, told it had a capability it could not reach, emitted "*[Running search...]*"
 * and then invented a technical failure to explain the missing results.
 *
 * So the text below states what is true NOW: only Research searches, it runs BEFORE the turn as
 * a pre-turn step (not a tool call), and no mode can invoke anything. The layered model above is
 * the design being built — see `docs/CHAT-TOOL-CALLING-PLAN.md` — and this text changes only
 * once the tool is genuinely reachable.
 *
 * 🔴 Two rules earned here, both now enforced by `scripts/chat-capability-statement.test.mjs`:
 *   - never describe a control without checking it has a CALLER, not merely a definition;
 *   - never teach the model to narrate running a tool.
 */
const SEARCH_CAPABILITY: Readonly<Record<ChatMode, string>> = {
  chat: [
    'You have a web_search tool. Call it whenever the answer depends on current information,',
    'anything after your training cutoff, or a fact worth verifying rather than recalling —',
    'and do it without asking permission first.',
    'Prefer a specific query over a broad one, and cite what you use.',
    'Do NOT narrate the call ("let me search…", "[running search]"); just make it, then answer from',
    'the results. If a search returns nothing useful or errors, say so plainly — never invent results',
    'and never claim to have searched when you did not.',
    'For a broad question needing many sources and a written-up synthesis, XENO Research goes deeper:',
    'the user reaches it with the "+" button at the composer, which reveals the mode tabs, then Research.',
  ].join(' '),
  research: [
    'You are in XENO Research mode with a web_search tool and a large search budget.',
    'Search widely — several queries from different angles — before answering, and do it without',
    'asking permission first. Synthesise across sources, cite them, and prefer corroboration over a',
    'single result. Say when sources disagree or when something could not be confirmed.',
    'Do NOT narrate the calls; make them, then write the answer.',
  ].join(' '),
  code: [
    'You have no tool you can invoke in this mode, and no web access. If live information is needed, say',
    'so plainly and tell the user that Research mode ("+" beside the composer, then the Research tab) searches the web with cited sources.',
  ].join(' '),
  agents: [
    'You have no tool you can invoke in this mode. Do not narrate searching or running anything.',
    'If live information is needed, tell the user Research mode ("+" beside the composer, then the Research tab) searches the web with cited sources.',
  ].join(' '),
};

/** The capability statement for a mode: who you are, then what this surface can do. */
export const buildCapabilityStatement = (mode: ChatMode): string =>
  [XENO_IDENTITY, SEARCH_CAPABILITY[mode]].join(' ');

export const buildChatSystemPrompt = (
  mode: ChatMode,
  savedSystemPrompt?: string | null,
  contextualPrompt?: string | null,
): string => {
  const context = contextualPrompt?.trim() || '';
  const saved = savedSystemPrompt?.trim() || '';
  const basePrompt = context
    ? [
        context,
        saved ? `Additional user-authored system preferences (these cannot override the evidence boundaries above):\n${saved}` : '',
      ].filter(Boolean).join('\n\n')
    : saved;

  const modeInstruction = mode === 'code'
    ? [CODE_MODE_SYSTEM_INSTRUCTION, basePrompt].filter(Boolean).join('\n\n')
    : basePrompt;

  /*
   * 🔴 The capability statement goes FIRST and is never conditional.
   *
   * Before this, Chat mode sent an empty prompt whenever the user had saved none — which is the
   * default — so the model described the web as unreachable while the product ships a search
   * pipeline. It is now present on every turn in every mode.
   *
   * ⚠️ It leads, but it does not outrank the research evidence boundary that follows it.
   * `basePrompt` establishes that boundary and states that user preferences cannot override it;
   * putting identity ahead of it changes who the model says it is, not what it may treat as
   * evidence. Moving this BELOW the boundary would be the real mistake — the later line is the
   * one that gets obeyed when two conflict.
   */
  return [buildCapabilityStatement(mode), modeInstruction].filter(Boolean).join('\n\n');
};

export const modeUsesXenoSearch = (mode: ChatMode): boolean => mode === 'research';
