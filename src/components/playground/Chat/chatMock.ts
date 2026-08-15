// chatMock.ts
// ---------------------------------------------------------------------------
// DEV-only mock backend for the Chat LLM UI.
//
// Installs a `window.fetch` interceptor so the interface works FULLY OFFLINE —
// no login, no backend. Each mocked endpoint returns the SAME response shape as
// the real API, so switching to the real backend is a no-op: just disable the
// mock (production builds already have it off).
//
// Scope so far (built one feature at a time):
//   • POST /api/chat/generate  → the assistant reply (Send → answer)
//   • GET  /api/models         → the model picker catalog
// Everything else falls through to the real fetch untouched.
//
// Toggle:
//   • ON by default while Vite runs in dev (`npm run start`).
//   • Force OFF (use the real backend):  localStorage.setItem('xeno_chat_mock', 'off')
//   • Force ON in a prod-like build:     localStorage.setItem('xeno_chat_mock', 'on')
// ---------------------------------------------------------------------------

import type { ModelsResponse } from '@/services/modelService';

const readFlag = (): string | null => {
  try {
    return localStorage.getItem('xeno_chat_mock');
  } catch {
    return null;
  }
};

const MOCK_ENABLED =
  (import.meta.env.DEV && readFlag() !== 'off') || readFlag() === 'on';

/** Build a JSON Response after an optional delay (so the "Thinking" UI shows). */
const jsonResponse = (data: unknown, delayMs = 0): Promise<Response> =>
  new Promise((resolve) => {
    const send = () =>
      resolve(
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    if (delayMs > 0) setTimeout(send, delayMs);
    else send();
  });

// ---------------------------------------------------------------------------
// GET /api/models
// ---------------------------------------------------------------------------
const now = Date.now();
const MOCK_MODELS: ModelsResponse = {
  success: true,
  timestamp: new Date(now).toISOString(),
  totalCompanies: 4,
  companies: {
    OpenAI: [
      { id: 'openai/gpt-5.6-terra', name: 'GPT-5.6 Terra', maxTokens: 200_000, created: now, inputModalities: ['text', 'image', 'file'], outputModalities: ['text'], supportsReasoning: 'toggleable', supportsVision: true, supportsFileUpload: true },
      { id: 'openai/gpt-5.5', name: 'GPT-5.5', maxTokens: 128_000, created: now - 10, inputModalities: ['text', 'image', 'file'], outputModalities: ['text'], supportsVision: true, supportsFileUpload: true },
      { id: 'openai/o4', name: 'o4', maxTokens: 200_000, created: now - 20, inputModalities: ['text', 'image', 'file'], outputModalities: ['text'], supportsReasoning: 'toggleable', supportsVision: true, supportsFileUpload: true },
      { id: 'openai/o4-mini', name: 'o4 Mini', maxTokens: 200_000, created: now - 30, inputModalities: ['text', 'image'], outputModalities: ['text'], supportsReasoning: 'toggleable', supportsVision: true },
    ],
    Anthropic: [
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', maxTokens: 200_000, created: now - 5, inputModalities: ['text', 'image', 'file'], outputModalities: ['text'], supportsReasoning: 'toggleable', supportsVision: true, supportsFileUpload: true },
    ],
    Google: [
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', maxTokens: 1_000_000, created: now - 6, inputModalities: ['text', 'image', 'file'], outputModalities: ['text'], supportsReasoning: 'toggleable', supportsVision: true, supportsFileUpload: true },
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', maxTokens: 1_000_000, created: now - 7, inputModalities: ['text', 'image', 'file'], outputModalities: ['text'], supportsReasoning: 'toggleable', supportsVision: true, supportsFileUpload: true },
    ],
    xAI: [
      { id: 'xai/grok-4', name: 'Grok 4', maxTokens: 128_000, created: now - 8, inputModalities: ['text', 'image'], outputModalities: ['text'], supportsReasoning: 'toggleable', supportsVision: true },
    ],
  },
};

// ---------------------------------------------------------------------------
// POST /api/v2/engine/{google,brave}-search  → web sources
//
// Not reached by Research mode as it stands. Measured with the network watched: turning on
// Research and sending produces no request to either endpoint, because that flow goes through
// `xenoSearchService` over its WebSocket instead. What does call them is `performProviderSearch`
// in ChatWithLLM, on the Google/Brave branch — so this is the fixture waiting for that path, and
// the shape it expects (`{ results: [...] }`), not a dead block someone forgot.
// ---------------------------------------------------------------------------
const MOCK_SEARCH_RESULTS = [
  {
    url: 'https://arxiv.org/abs/2312.06648',
    title: 'Neural Extractive Summarization with Redundancy Control',
    snippet:
      'A salience model with an explicit redundancy penalty — the standard baseline for de-duplicated summaries.',
    description:
      'Introduces a redundancy-aware objective so extractive summaries reward coverage per idea rather than per line.',
  },
  {
    url: 'https://aclanthology.org/2023.acl-long.155/',
    title: 'Ranking Sentences for Extractive Summarization',
    snippet: 'Salience estimation over long transcripts with a learned relevance + position score.',
    description: 'A ranking approach that scores each turn by relevance, position, and novelty.',
  },
  {
    url: 'https://www.semanticscholar.org/paper/redundancy-aware-summarizer',
    title: 'A Redundancy-Aware Neural Summarizer',
    snippet: 'Clusters claims by theme before compression to avoid repeating the same point.',
    description: 'Theme clustering as a pre-step to compression reduces duplicate claims.',
  },
  {
    url: 'https://langchain.dev/docs/use_cases/summarization',
    title: 'Grouping and de-duplicating retrieved claims',
    snippet: 'Practical guidance for collapsing near-duplicate claims in a summarisation chain.',
    description: 'How to group and dedupe retrieved claims before rendering the final summary.',
  },
  {
    url: 'https://eval.blog/summary-metrics',
    title: 'Human vs automatic summary evaluation',
    snippet: 'Why ROUGE under-rewards de-duplicated summaries and how human raters differ.',
    description: 'A comparison of ROUGE against human judgement for de-duplicated summaries.',
  },
];

// ---------------------------------------------------------------------------
// POST /api/chat/generate
// ---------------------------------------------------------------------------
type GeneratePart = { type: string; text?: string };
type GenerateMessage = { role?: string; parts?: GeneratePart[] };
type GenerateBody = {
  messages?: GenerateMessage[];
  selectedModelId?: string;
  task?: string;
  useSearchTool?: boolean;
};

/** 1×1 transparent PNG — placeholder for the image task (polished in a later step). */
const PLACEHOLDER_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const lastUserText = (messages: GenerateMessage[] = []): string => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      return (messages[i].parts ?? [])
        .filter((p) => p.type === 'text' && p.text)
        .map((p) => p.text)
        .join('\n')
        .trim();
    }
  }
  return '';
};

const buildMockAnswer = (userText: string): string => {
  const echo = userText.length > 120 ? `${userText.slice(0, 120)}…` : userText;

  // A tiny inline SVG (data URI) so the image element renders offline.
  const diagramSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="560" height="132">' +
    '<rect width="560" height="132" rx="12" fill="#16181d"/>' +
    '<g font-family="ui-monospace, monospace" font-size="15" fill="#e6e4df">' +
    '<rect x="26" y="47" width="128" height="38" rx="8" fill="#101216" stroke="#2a2f3a"/><text x="52" y="71">Extract</text>' +
    '<rect x="216" y="47" width="128" height="38" rx="8" fill="#101216" stroke="#2a2f3a"/><text x="236" y="71">Compress</text>' +
    '<rect x="406" y="47" width="128" height="38" rx="8" fill="#101216" stroke="#2a2f3a"/><text x="436" y="71">Render</text>' +
    '</g><g stroke="#6da7ec" stroke-width="2" fill="none"><path d="M160 66h48"/><path d="M350 66h48"/></g></svg>';
  const diagramImg =
    typeof btoa !== 'undefined'
      ? `data:image/svg+xml;base64,${btoa(diagramSvg)}`
      : `data:image/svg+xml,${encodeURIComponent(diagramSvg)}`;

  return [
    '# Everything a chat message can render',
    '',
    echo
      ? `You asked: **“${echo}”** — here's a full-fidelity reply that exercises every element.`
      : "Here's a full-fidelity reply that exercises every render element.",
    '',
    'It carries **bold**, *italic*, ~~strikethrough~~, `inline code`, and a [link](https://xenostudio.ai).',
    '',
    '## Lists',
    '',
    'Unordered, with nesting:',
    '',
    '- Extract the key turns',
    '  - decisions',
    '  - open questions',
    '- Compress each into a one-line claim',
    '- Render, grouped by theme',
    '',
    'Ordered steps:',
    '',
    '1. Split the pipeline into three stages',
    '2. Dedupe claims by theme',
    '3. Ship behind a flag',
    '',
    'A checklist:',
    '',
    '- [x] Split the pipeline',
    '- [x] Add dedupe-by-theme',
    '- [ ] Shadow-run last week’s transcripts',
    '- [ ] Compare summaries side-by-side',
    '',
    '## A quote',
    '',
    '> A summary is a compression, not a transcript — reward coverage per idea, not per line.',
    '',
    '## A table',
    '',
    '| Stage | Input | Output |',
    '| --- | --- | --- |',
    '| Extract | Transcript | Salient turns |',
    '| Compress | Salient turns | Claims |',
    '| Render | Claims | Markdown |',
    '',
    '## Code',
    '',
    '```ts',
    'export function summarise(turns: Turn[]): Summary {',
    '  const claims = turns',
    '    .filter((t) => t.salient)',
    '    .map((t) => `${t.speaker}: ${compress(t.text)}`);',
    '  return { claims, groupedBy: "theme" }; // render later',
    '}',
    '```',
    '',
    '```python',
    'def greet(name: str) -> str:',
    '    return f"Hello, {name}!"',
    '```',
    '',
    '```bash',
    'npm run start   # dev server on :5183',
    '```',
    '',
    '## An inline diagram',
    '',
    `![Pipeline: Extract → Compress → Render](${diagramImg})`,
    '',
    '---',
    '',
    '### Wrapping up',
    '',
    'That covered headings, **inline formatting**, nested lists, a task list, a blockquote, a table, three code blocks, an image, and a divider — the full render path. Toggle **Research** and re-send to add a multi-step thinking trace and web sources.',
  ].join('\n');
};

const buildMockThinking = (userText: string, searching?: boolean): string => {
  const q = userText.length > 120 ? `${userText.slice(0, 120)}…` : userText || 'the request';
  const lines = [
    'Let me work through this carefully.',
    '',
    `- The user asked: "${q}".`,
    `- Goal: a clear, well-structured answer${searching ? ', grounded in current sources' : ''}.`,
  ];
  if (searching) {
    lines.push('- Plan: search, skim the strongest results, cross-check, then synthesize.');
    lines.push('- Ran a few queries and compared a couple of sources so the answer holds up.');
  } else {
    lines.push('- Plan: outline the key points, then write them concisely with examples.');
  }
  lines.push('- Shape: a short intro, the main points, a table, and a small code example.');
  lines.push('');
  lines.push('Proceeding to write the final answer.');
  return lines.join('\n');
};

const mockGenerate = (body: GenerateBody): unknown => {
  const modelIdUsed = body.selectedModelId || 'openai/gpt-5.6-terra';

  if (body.task === 'image') {
    return { imageData: PLACEHOLDER_PNG, modelIdUsed };
  }
  if (body.task === 'refine_image_prompt') {
    return {
      refinedPromptText:
        'A serene mock landscape at golden hour, soft volumetric light, highly detailed',
      modelIdUsed,
    };
  }

  // Return separate thinking + answer so the collapsible "Thoughts" section
  // renders above the reply (reasoningProcessed drives the frontend path).
  const userText = lastUserText(body.messages);
  return {
    reasoningProcessed: true,
    thinking: buildMockThinking(userText, body.useSearchTool),
    answer: buildMockAnswer(userText),
    modelIdUsed,
  };
};

// ---------------------------------------------------------------------------
// Installer
// ---------------------------------------------------------------------------
const matchesPath = (url: string, path: string): boolean => {
  const clean = url.split('?')[0];
  return clean === path || clean.endsWith(path);
};

type MockRoute = (url: string, init: RequestInit | undefined) => Promise<Response> | null;

/**
 * The routing table. Reassigned on every module eval so HMR edits to the mock
 * apply WITHOUT a full page reload — the fetch wrapper is installed once and
 * always calls the latest route via a window reference. Returns null when the
 * request is not mocked (the wrapper then falls through to the real fetch).
 */
const route: MockRoute = (url, init) => {
  try {
    if (matchesPath(url, '/api/chat/generate') && (init?.method ?? 'GET').toUpperCase() === 'POST') {
      const body: GenerateBody = init?.body ? JSON.parse(init.body as string) : {};
      // Longer when "searching" so the multi-step thinking timeline plays out;
      // shorter for a plain chat answer.
      const delay = body.useSearchTool
        ? 4200 + Math.floor(Math.random() * 1200)
        : 1800 + Math.floor(Math.random() * 1200);
      return jsonResponse(mockGenerate(body), delay);
    }
    if (matchesPath(url, '/api/models')) {
      return jsonResponse(MOCK_MODELS, 150);
    }
    if (
      matchesPath(url, '/api/v2/engine/google-search') ||
      matchesPath(url, '/api/v2/engine/brave-search')
    ) {
      // Web sources for Research mode — enough for the "Web Sources" block to render.
      return jsonResponse({ results: MOCK_SEARCH_RESULTS }, 700);
    }
    if (matchesPath(url, '/api/tokenize/messages')) {
      // Local ~4-chars-per-token estimate, in the shape the service expects.
      // Mainly here to stop the offline 500 retry flood from the tokenizer.
      const body = init?.body ? JSON.parse(init.body as string) : {};
      const msgs: Array<{ content?: string; text?: string }> = body.messages ?? [];
      const messageTokens = msgs.map((m) => Math.ceil(((m.content ?? m.text ?? '').length) / 4));
      const systemTokens = Math.ceil(((body.systemPrompt ?? '') as string).length / 4);
      const overhead = msgs.length * 4 + (body.systemPrompt ? 4 : 0);
      const total = messageTokens.reduce((a: number, b: number) => a + b, 0) + systemTokens + overhead;
      return jsonResponse({ success: true, messageTokens, systemTokens, total, overhead });
    }
  } catch {
    // fall through to the real fetch
  }
  return null;
};

interface MockWindow {
  __xenoChatMockInstalled?: boolean;
  __xenoChatMockRoute?: MockRoute;
}

export const installChatMock = (): void => {
  if (!MOCK_ENABLED) return;
  const w = window as unknown as MockWindow;
  w.__xenoChatMockRoute = route; // always refresh so HMR edits apply
  if (w.__xenoChatMockInstalled) return; // wrap window.fetch only once
  w.__xenoChatMockInstalled = true;

  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const handled = w.__xenoChatMockRoute?.(url, init) ?? null;
    return handled ?? realFetch(input, init);
  };

  // eslint-disable-next-line no-console
  console.info(
    '[chatMock] Offline mock backend active: /api/chat/generate, /api/models, /api/tokenize. ' +
      "Disable with localStorage.setItem('xeno_chat_mock','off') then reload.",
  );
};

// Self-install on import, then re-run on HMR so mock edits apply without a
// full page reload.
installChatMock();
if (import.meta.hot) {
  import.meta.hot.accept();
}
