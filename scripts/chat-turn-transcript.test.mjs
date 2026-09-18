/**
 * The Chat turn renders through the CANONICAL transcript — proven by mounting it.
 *
 * `ChatTurnHead` hands `TranscriptTurn` (`@xenosystem/agent-conversation`, D10) a message built by
 * `toTranscriptMessage` from the chat's own turn record. Unit gates on the adapter alone would say
 * the pieces are correct and nothing about whether they connect — the workspace's recurring
 * "built, tested, unreachable" shape — so this mounts the real component in a DOM, in both step
 * modes, live and settled, and reads what the person would read.
 */
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import testUtils from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { act } = testUtils;
const motionStubPath = fileURLToPath(new URL('./framer-motion-test-stub.mjs', import.meta.url));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
};

const vite = await createServer({
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  resolve: { alias: { 'framer-motion': motionStubPath } },
  server: { middlewareMode: true },
});

let dom;
try {
  const turnModule = await vite.ssrLoadModule('/src/components/playground/Chat/chatTurnTranscript.ts');
  const { applyTurnEvent, closeTurnRecord, newTurnRecord, normalizeStoredTurn, toTranscriptMessage, turnHasRail } = turnModule;

  // ── the record, pure ──────────────────────────────────────────────────────────────────
  {
    let record = newTurnRecord(1000);
    record = applyTurnEvent(record, { type: 'search_start', query: 'xeno hub launcher' }, 1200);
    check('a search_start opens a step with its query', record.steps.length === 1 && record.steps[0].query === 'xeno hub launcher' && record.steps[0].endedAt === undefined);
    record = applyTurnEvent(record, { type: 'search_result', query: 'xeno hub launcher', count: 3, sources: [{ url: 'https://xenostudio.ai/product/hub', title: 'XENO Hub' }, { url: 'http://insecure.example/', title: 'nope' }] }, 2500);
    check('a search_result closes the open step with its count and https sources only', record.steps[0].endedAt === 2500 && record.steps[0].count === 3 && record.steps[0].sources.length === 1);
    record = applyTurnEvent(record, { type: 'search_start', query: 'second' }, 2600);
    record = applyTurnEvent(record, { type: 'search_error', query: 'second', code: 'rate_limited', message: 'That search could not be completed.' }, 3000);
    check('a search_error closes its step with the error', record.steps[1].error && record.steps[1].endedAt === 3000);
    const unmatched = applyTurnEvent(record, { type: 'search_result', query: 'never started', count: 1 }, 3100);
    check('a result the loop never announced still lands as a settled step — nothing reported is dropped', unmatched.steps.length === 3 && unmatched.steps[2].endedAt === 3100);
    const closed = closeTurnRecord(applyTurnEvent(record, { type: 'search_start', query: 'open' }, 3200), 4000);
    check('closing the record ends every open step and stamps the turn', closed.endedAt === 4000 && closed.steps.every((s) => s.endedAt !== undefined));
    const roundTrip = normalizeStoredTurn(JSON.parse(JSON.stringify(closed)));
    check('a stored record reads back whole', roundTrip && roundTrip.steps.length === 3 && roundTrip.steps[0].sources[0].url === 'https://xenostudio.ai/product/hub');
    check('a stored value that is not a v1 record is absent, never a crash', normalizeStoredTurn({ schema: 'other' }) === undefined && normalizeStoredTurn('x') === undefined);
    check('a turn with no steps and no thought has no rail', !turnHasRail(newTurnRecord(), '') && turnHasRail(record, '') && turnHasRail(undefined, 'a thought'));
  }

  // ── the adapter: the chat's turn in the transcript's own terms ───────────────────────
  {
    const record = closeTurnRecord(applyTurnEvent(applyTurnEvent(newTurnRecord(1000), { type: 'search_start', query: 'q' }, 1100), { type: 'search_result', query: 'q', count: 2, sources: [{ url: 'https://a.example/', title: 'A' }, { url: 'https://b.example/', title: 'B' }] }, 1900), 2500);
    const msg = toTranscriptMessage({ id: 'm1', thinking: 'weighing it', streaming: false, replyStarted: true, timestamp: 1000, model: 'grok-4.6', turn: record });
    check('the reply is EMPTY on purpose — the chat renders the answer, the transcript renders the head', msg.content === '');
    check('each search is a web_search tool call in a segment, in order', msg.toolCalls.length === 1 && msg.toolCalls[0].toolName === 'web_search' && msg.segments[0].toolCallId === msg.toolCalls[0].id);
    check('a settled search carries its sources as the result text the step model parses', /https:\/\/a\.example\//.test(msg.toolCalls[0].result) && msg.toolCalls[0].status === 'done' && msg.toolCalls[0].outcome === 'succeeded');
    check('the turn keeps its start and end so a reopened turn still says how long it took', msg.timestamp === 1000 && msg.endedAt === 2500 && msg.thinking === 'weighing it');
    const live = toTranscriptMessage({ id: 'm2', streaming: true, replyStarted: false, thinking: 'hmm', turn: applyTurnEvent(newTurnRecord(1000), { type: 'search_start', query: 'live q' }, 1100) });
    check('a live search is a running tool call and the thought is live until the reply starts', live.toolCalls[0].status === 'running' && live.isThinking === true && live.isStreaming === true);
  }

  // ── the real component, mounted ───────────────────────────────────────────────────────
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node,
    Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, KeyboardEvent: dom.window.KeyboardEvent,
    MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(() => callback(Date.now()), 0);
  dom.window.cancelAnimationFrame = (id) => dom.window.clearTimeout(id);
  if (!dom.window.matchMedia) dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.matchMedia = dom.window.matchMedia;

  const { default: ChatTurnHead } = await vite.ssrLoadModule('/src/components/playground/Chat/ChatTurnHead.tsx');
  const root = createRoot(document.getElementById('root'));
  const render = async (props) => {
    await act(async () => { root.render(React.createElement(ChatTurnHead, props)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    return document.getElementById('root');
  };

  const liveRecord = applyTurnEvent(newTurnRecord(Date.now() - 4000), { type: 'search_start', query: 'xeno hub launcher' }, Date.now() - 1000);
  const openingEl = await render({ messageId: 'p1', streaming: true, replyStarted: false, stepsMode: 'expanded', turn: newTurnRecord(Date.now() - 3000) });
  check('an opening turn shows the canonical clock line ("Working for …") — the chat\'s own spinner is gone', /Working for/.test(openingEl.textContent) && openingEl.querySelector('.xa-transcript'));

  const liveExpanded = await render({ messageId: 'p2', streaming: true, replyStarted: false, stepsMode: 'expanded', turn: liveRecord });
  check('expanded: a live search is drawn on the rail with its query', /Searching the web/.test(liveExpanded.textContent) && /xeno hub launcher/.test(liveExpanded.textContent));
  const expandedHtml = liveExpanded.innerHTML;

  const liveCollapsed = await render({ messageId: 'p2', streaming: true, replyStarted: false, stepsMode: 'collapsed', turn: liveRecord });
  check('collapsed: the current step rides the clock line and the rail is not open', /xeno hub launcher/.test(liveCollapsed.textContent) && liveCollapsed.innerHTML !== expandedHtml);
  check('the mode is on the head for the stylesheet and for gates', liveCollapsed.querySelector('[data-steps-mode="collapsed"]') !== null);

  const done = closeTurnRecord(applyTurnEvent(liveRecord, { type: 'search_result', query: 'xeno hub launcher', count: 3, sources: [{ url: 'https://xenostudio.ai/product/hub', title: 'XENO Hub' }, { url: 'https://xenostudio.ai/docs', title: 'Docs' }, { url: 'https://xenosystem.ai/', title: 'XENO' }] }, Date.now() - 500), Date.now());
  const settled = await render({ messageId: 'p3', streaming: false, replyStarted: true, stepsMode: 'collapsed', thinking: 'first decide what XENO Hub is', turn: done, timestamp: done.startedAt, model: 'grok-4.6-high-fast' });
  const text = settled.textContent;
  check('a settled turn folds to the receipt ("Worked for …")', /Worked for/.test(text));
  check('the settled search reads as a record with its result count', /Searched the web/.test(settled.innerHTML) || /3 results/.test(settled.innerHTML));
  check('no reply, no action row — those stay the chat\'s own', !settled.querySelector('.xa-rfoot'));

  const expandedSettled = await render({ messageId: 'p4', streaming: false, replyStarted: true, stepsMode: 'expanded', turn: done, timestamp: done.startedAt });
  check('expanded: the settled rail stays open and lists the search', /Searched the web/.test(expandedSettled.textContent) && /3 results/.test(expandedSettled.textContent));

  const bare = closeTurnRecord(newTurnRecord(Date.now() - 3000), Date.now() - 100);
  const plain = await render({ messageId: 'p5', streaming: false, replyStarted: true, stepsMode: 'collapsed', turn: bare, timestamp: bare.startedAt });
  check('a plain reply — no steps, no thought — still rests under "Worked for …" (the chat asks for the clock on every turn)', /Worked for \d+s/.test(plain.textContent) && plain.querySelector('.xa-bare') !== null);

  await act(async () => { root.unmount(); });

  // ── reachability: the chat mounts the head where its own thinking box and spinner were ──
  const chat = readFileSync(new URL('../src/components/playground/Chat/ChatWithLLM.tsx', import.meta.url), 'utf8');
  check('the thinking placeholder renders ChatTurnHead (streaming) — not ThinkingAnimation', (chat.match(/<ChatTurnHead/g) || []).length >= 1 && !/<ThinkingAnimation\s+duration=\{liveTimerValue/.test(chat));
  /*
   * 2026-09-18: "it disappears and glitches when the answer appears". Three causes, each pinned:
   * the placeholder was its own element (remount on the first delta); the final message took a
   * fresh id (remount when the answer landed, mid-fold); and deltas went to `text` while the
   * bubble printed `parsedAnswer`, so the answer was invisible until it arrived whole.
   */
  check('ONE element from "Working for" to "Worked for": the thinking placeholder is rendered by the assistant block, not by an early return', /message\.isThinkingPlaceholder && message\.id === aiRefinementPlaceholderId\) \{/.test(chat) && !/if \(message\.isThinkingPlaceholder\) \{/.test(chat) && /message\.isStreaming \|\| message\.isThinkingPlaceholder\)/.test(chat));
  check('the final message keeps the placeholder id and replaces it in place — no remount when the answer lands', /id: localPlaceholderId,/.test(chat) && !/id: `ai-\$\{Date\.now\(\)\}`/.test(chat) && /prevMessages\.map\(msg => \(msg\.id === localPlaceholderId \? display : msg\)\)/.test(chat));
  check('the edit plate keeps its hairline and paints NOTHING on focus — no ring, no accent, no focus-within brightening (2026-09-18)', !chat.includes('border-[var(--chat-accent)]/70') && !chat.includes('focus-within:ring-1 focus-within:ring-[var(--chat-accent)]') && chat.includes('<div className="rounded-lg border border-[var(--chat-border)] bg-[var(--chat-canvas)]/40 px-2.5 py-2">') && !/bg-\[var\(--chat-canvas\)\]\/40 px-2\.5 py-2 [^"]*focus-within/.test(chat) && (chat.match(/className="focus-self[^"]*resize-y border-none/g) || []).length === 1);
  check('the user turn spans the column like the answer does — no 88 / 96 / 98 percent cap (2026-09-18)', (chat.match(/--xeno-message-max: 100%;/g) || []).length === 3 && !/--xeno-message-max: (88|96|98)%/.test(chat) && !/chat-message-editor flex w-full max-w-/.test(chat));
  check('streamed deltas are SHOWN as they arrive — the delta handler writes parsedAnswer, which is what the bubble prints', /parsedAnswer: streamedText,/.test(chat));
  check('search events grow the turn record on the placeholder', /turnRecord = applyTurnEvent\(turnRecord, event/.test(chat) && /msg\.id === localPlaceholderId \? \{ \.\.\.msg, turn: record \}/.test(chat));
  check('the final message carries the closed record and it is persisted', /turn: closeTurnRecord\(turnRecord\)/.test(chat) && /turn: updatedMessage\.turn,/.test(chat) && /turn: msg\.turn,/.test(chat));
  check('a stored message reads its turn back', /turn: isAi \? normalizeStoredTurn\(/.test(chat));
  const head = readFileSync(new URL('../src/components/playground/Chat/ChatTurnHead.tsx', import.meta.url), 'utf8');
  check('the chat asks for the clock on EVERY turn (clock="always") — a plain reply rests under "Worked for …"', /clock="always"/.test(head) && /\(message\.turn \|\| turnHasRail\(/.test(chat));
  check('the placeholder carries the start of the turn, so the opening clock counts from the request rather than from each render', /timestamp: thinkingStartTimeRef\.current, \/\/ the turn's clock starts here/.test(chat) && /timestamp=\{message\.turn\?\.startedAt \?\? message\.timestamp\}/.test(chat));
  check('a reasoning model that returned no trace shows NO thought box — the phantom "[Thinking process not provided…]" is gone', !/Thinking process not provided or markers not found/.test(chat) && !/localHasThinking = true;/.test(chat) && /\) : null\}/.test(chat));
  check('the steps mode is an account setting with a browser copy, and the modal exposes it', /debouncedSaveSetting\('chat\.stepsMode', stepsMode\)/.test(chat) && /isStepsMode\(settings\.chat\.stepsMode\)/.test(chat) && /onStepsModeChange=\{setStepsMode\}/.test(chat));
  const modal = readFileSync(new URL('../src/components/playground/Chat/ChatSettingsModal.tsx', import.meta.url), 'utf8');
  check('the Preferences pane offers both modes', /data-steps-mode-option=\{value\}/.test(modal) && /STEPS_MODES\.map/.test(modal));
  const css = readFileSync(new URL('../src/components/playground/Chat/chat-theme.css', import.meta.url), 'utf8');
  check('the transcript tokens are re-derived from the chat theme, light included — for the head AND the chip in the prose', /\.chat-themed :is\(\.chat-turn-head\.xa-transcript, \.xa-cite, \.chat-thread-scrubber\) \{/.test(css) && /\.chat-theme-light \.chat-turn-head\.xa-transcript/.test(css) && /\.chat-theme-light \.xa-cite \{ --xa-ink: 10, 10, 10; \}/.test(css) && !/--xa-label: [^}]*width: 100%/.test(css));

  // ── citations: the claim carries its evidence (2026-09-18) ───────────────────────────
  // The numbering contract is ONE rule on both sides: the server's admitSources numbers what it
  // hands the model; the chat's turnCitedSources numbers the record it kept. Prove they agree by
  // feeding the SERVER's events through the CLIENT's record and comparing ids.
  {
    const { admitSources } = await import('../src/server/utils/chatToolLoop.js');
    const { turnCitedSources } = turnModule;
    const turnSources = [];
    const search1 = admitSources(turnSources, [{ title: 'One', url: 'https://one.test/a' }, { title: 'Two', url: 'https://two.test/b' }]);
    const search2 = admitSources(turnSources, [{ title: 'Two again', url: 'https://two.test/b' }, { title: 'Three', url: 'https://three.test/c' }]);
    let record = newTurnRecord(1000);
    record = applyTurnEvent(record, { type: 'search_start', query: 'q1' }, 1100);
    record = applyTurnEvent(record, { type: 'search_result', query: 'q1', count: 2, sources: search1.map(({ id, title, url }) => ({ id, title, url })) }, 1200);
    record = applyTurnEvent(record, { type: 'search_start', query: 'q2' }, 1300);
    record = applyTurnEvent(record, { type: 'search_result', query: 'q2', count: 2, sources: search2.map(({ id, title, url }) => ({ id, title, url })) }, 1400);
    const client = turnCitedSources(closeTurnRecord(record, 1500)).map((s) => `${s.id}:${s.url}`);
    const server = turnSources.map((s) => `${s.id}:${s.url}`);
    check('🔴 the client numbers the turn\'s sources exactly as the server numbered them for the model', JSON.stringify(client) === JSON.stringify(server), `${client} vs ${server}`);
    check('a source cited from a second search keeps the id it had — [2] means the same page in every step', client[1] === '2:https://two.test/b' && client.length === 3);
    check('a stored record (JSON round trip) numbers the same', JSON.stringify(turnCitedSources(normalizeStoredTurn(JSON.parse(JSON.stringify(closeTurnRecord(record, 1500))))).map((s) => `${s.id}:${s.url}`)) === JSON.stringify(server));
    check('the chat\'s favicon resolver is OUR proxy, never the site', turnModule.chatFaviconUrl('en.wikipedia.org') === '/api/favicon?domain=en.wikipedia.org');
  }
  check('the answer\'s markdown runs remarkCitations and renders a cited [n] as the canonical CitationChip with the turn\'s numbered sources', /remarkPlugins=\{\[remarkGfm, remarkCitations\]\}/.test(chat) && /const citedIds = parseCitationHref\(href\);/.test(chat) && /<CitationChip ids=\{citedIds\} sources=\{turnCitedSources\(message\.turn\)\} faviconUrl=\{chatFaviconUrl\}>/.test(chat));
  check('every other link in an answer opens in a new tab, never navigates the chat away', /return <a href=\{href\} target="_blank" rel="noopener noreferrer">\{children\}<\/a>;/.test(chat));
  check('the turn head paints real favicons through the proxy', /faviconUrl=\{chatFaviconUrl\}/.test(head));
  const server = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
  // ── the thread scrubber: the conversation map (2026-09-18 /isg) ───────────────────────
  check('the chat mounts the canonical ThreadScrubber on its own scroller, fed from STATE (messages), with placeholders left out', /<ThreadScrubber\s+turns=\{scrubberTurns\}\s+scrollerRef=\{chatAreaRef\}/.test(chat) && /useMemo<ScrubberTurn\[\]>\(\(\) => messages/.test(chat) && /!m\.isThinkingPlaceholder && !m\.isDotPlaceholder && !m\.isError/.test(chat));
  check('every message element carries data-turn so the map can find it', /data-turn=\{message\.id\}/.test(chat));
  check('a turn that searched is MARKED on the rail', /marked: !!\(m\.turn\?\.steps\?\.length\)/.test(chat));
  check('the rail is centred in the visible thread — between the top bar and the composer dock, whose height is measured, not assumed', /ref=\{composerDockRef\}/.test(chat) && /new ResizeObserver\(measure\);\s*observer\.observe\(dock\)/.test(chat) && /calc\(50% \+ \$\{Math\.round\(\(64 - composerDockHeight\) \/ 2\)\}px\)/.test(chat));
  check('the rail carries the transcript tokens inside the chat theme, light included', /\.chat-themed \.chat-thread-scrubber \{/.test(css) && /\.chat-theme-light \.chat-thread-scrubber \{ --xa-ink: 10, 10, 10; \}/.test(css));
  check('the favicon proxy is MOUNTED, not just written', /app\.use\('\/api\/favicon', faviconRoutes\);/.test(server) && /import faviconRoutes from '\.\/routes\/faviconRoutes\.js';/.test(server));
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  check('the canonical stylesheet is loaded once, at the entry', /@xenosystem\/agent-conversation\/styles\.css/.test(main));
} finally {
  await vite.close();
  dom?.window.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gates passed`);
if (failed.length) process.exitCode = 1;
