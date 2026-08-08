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
  const echo = userText.length > 160 ? `${userText.slice(0, 160)}…` : userText;
  return [
    '### Mock response',
    '',
    echo ? `You said: **“${echo}”**` : 'This is a simulated assistant reply.',
    '',
    'This reply is generated locally so you can build the chat frontend with no backend. It exercises the full render path:',
    '',
    '- Markdown — headings, lists, **bold**, `inline code`',
    '- Fenced code blocks (with the Run / Copy header)',
    '- The “Thinking” placeholder + timer during the artificial delay',
    '',
    '```ts',
    'function greet(name: string): string {',
    '  return `Hello, ${name}!`;',
    '}',
    "console.log(greet('XENO'));",
    '```',
    '',
    '> Generated by `chatMock.ts`. Swap it for the real `/api/chat/generate`',
    "> backend by running `localStorage.setItem('xeno_chat_mock','off')`.",
  ].join('\n');
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

  return {
    text: buildMockAnswer(lastUserText(body.messages)),
    modelIdUsed,
    reasoningProcessed: false,
  };
};

// ---------------------------------------------------------------------------
// Installer
// ---------------------------------------------------------------------------
const matchesPath = (url: string, path: string): boolean => {
  const clean = url.split('?')[0];
  return clean === path || clean.endsWith(path);
};

export const installChatMock = (): void => {
  if (!MOCK_ENABLED) return;
  const w = window as unknown as { __xenoChatMockInstalled?: boolean };
  if (w.__xenoChatMockInstalled) return;
  w.__xenoChatMockInstalled = true;

  const realFetch = window.fetch.bind(window);

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    try {
      if (matchesPath(url, '/api/chat/generate') && (init?.method ?? 'GET').toUpperCase() === 'POST') {
        const body: GenerateBody = init?.body ? JSON.parse(init.body as string) : {};
        // Longer when "searching" so the multi-step thinking timeline plays out;
        // shorter for a plain chat answer.
        const delay = body.useSearchTool
          ? 4200 + Math.floor(Math.random() * 1200)
          : 1800 + Math.floor(Math.random() * 1200);
        return await jsonResponse(mockGenerate(body), delay);
      }
      if (matchesPath(url, '/api/models')) {
        return await jsonResponse(MOCK_MODELS, 150);
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
        return await jsonResponse({ success: true, messageTokens, systemTokens, total, overhead });
      }
    } catch {
      // If anything goes wrong building the mock, fall through to the real fetch.
    }

    return realFetch(input as RequestInfo, init);
  };

  // eslint-disable-next-line no-console
  console.info(
    '[chatMock] Offline mock backend active: /api/chat/generate, /api/models. ' +
      "Disable with localStorage.setItem('xeno_chat_mock','off') then reload.",
  );
};

// Self-install on import (guarded + idempotent), so it is active before the
// component's first fetch. No-op in production or when toggled off.
installChatMock();
