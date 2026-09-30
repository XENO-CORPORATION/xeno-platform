/**
 * The chat's prompt queue: every queued prompt is sent, in order, exactly once.
 *
 * ## Why (2026-09-30)
 * Three prompts queued behind a running reply produced TWO replies. The auto-send effect set the
 * composer's text and then called handleGenerate(), which reads that state from the render it was
 * created in — one step behind — so each send carried the PREVIOUS prompt and the last one was
 * removed and never sent. Reproduced in the browser before the fix (2 of 3) and after it (3 of 3).
 *
 * The queue's transitions are pure (chatQueueState.ts) and tested against exact cases; the effect's
 * wiring is pinned from source, because the defect lived in HOW the component used them.
 *
 * Mutation-checked:
 *   - send through the composer again (setInput + handleGenerate())   -> "the prompt's own text" fails
 *   - remove before nextSendable decides                             -> "nothing removed while waiting" fails
 *   - guard the effect with a ref instead of state                   -> "the guard is state" fails
 *   - drop the scanning rule                                         -> the scanning case fails
 *   - let an edit save an empty prompt                               -> the empty-edit case fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHAT_DIR = join(ROOT, 'src', 'components', 'playground', 'Chat');
const read = (name) => readFileSync(join(CHAT_DIR, name), 'utf8').replace(/\r\n/g, '\n');
const chat = read('ChatWithLLM.tsx');

const vite = await createServer({ appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
try {
  const Q = await vite.ssrLoadModule('/src/components/playground/Chat/chatQueueState.ts');
  const item = (id, text, files = []) => ({ id, text, attachedFiles: files, timestamp: 0 });
  const three = () => ['a', 'b', 'c'].reduce((s, id) => Q.enqueue(s, item(id, `prompt ${id}`)), Q.emptyQueue());

  test('draining the queue sends every prompt, in order, exactly once', () => {
    let state = three();
    const sent = [];
    for (;;) {
      const next = Q.nextSendable(state, { held: false });
      if (!('item' in next)) { assert.equal(next.wait, 'empty'); break; }
      sent.push(next.item.text);
      state = Q.removeQueued(state, next.item.id);
    }
    assert.deepEqual(sent, ['prompt a', 'prompt b', 'prompt c']);
  });

  test('an empty prompt is refused; a file-only prompt is queued', () => {
    const empty = Q.emptyQueue();
    assert.equal(Q.enqueue(empty, item('x', '   ')), empty);
    assert.equal(Q.enqueue(empty, item('y', '', [{ id: 'f', name: 'f.txt', type: 'text/plain' }])).messages.length, 1);
  });

  test('nothing is removed while the queue waits: held, or an attachment still scanning', () => {
    const state = three();
    assert.deepEqual(Q.nextSendable(state, { held: true }), { wait: 'held' });
    const scanning = Q.enqueue(Q.emptyQueue(), item('s', 'with file', [{ id: 'f1', name: 'a.pdf', type: 'application/pdf', ready: false }]));
    assert.deepEqual(Q.nextSendable(scanning, { held: false }), { wait: 'scanning' });
    const ready = Q.markQueuedFileReady(scanning, 'f1');
    assert.notEqual(ready, scanning, 'a scan clearing is a NEW state, so the auto-send effect re-runs');
    assert.equal(Q.nextSendable(ready, { held: false }).item.id, 's');
  });

  test('reorder moves the send order; out-of-range is a no-op', () => {
    const moved = Q.moveQueued(three(), 2, 0);
    assert.deepEqual(moved.messages.map((m) => m.id), ['c', 'a', 'b']);
    const s = three();
    assert.equal(Q.moveQueued(s, 5, 0), s);
    assert.deepEqual(Q.moveQueued(s, 0, 99).messages.map((m) => m.id), ['b', 'c', 'a'], 'the target is clamped');
  });

  test('an edit that would leave a prompt empty keeps its text', () => {
    const s = three();
    assert.equal(Q.updateQueued(s, 'a', { text: '   ' }), s);
    assert.equal(Q.updateQueued(s, 'a', { text: ' new ' }).messages[0].text, 'new');
  });

  test('reachability: the effect sends the prompt\'s own text and files, and removes only what it sends', () => {
    const at = chat.indexOf('const [isQueueSending, setIsQueueSending] = useState(false);');
    assert.notEqual(at, -1, 'the guard is state, so a finished send re-runs the effect');
    const effect = chat.slice(at, chat.indexOf('}, [isLoading, isQueueSending, queue, isQueueHeld', at));
    assert.match(effect, /const next = nextSendable\(queue, \{ held: isQueueHeld \}\);\s*if \(!\('item' in next\)\) return;/, 'nextSendable decides before anything is removed');
    assert.match(effect, /handleGenerate\(item\.text, item\.attachedFiles\)/, 'the prompt\'s own text and files go to handleGenerate');
    assert.doesNotMatch(effect, /setInput\(/, 'the composer is not used as a mailbox for the queued prompt');
    assert.ok(effect.indexOf('removeQueued') > effect.indexOf("'item' in next"), 'removal comes after the send decision');
    assert.match(chat, /const handleGenerate = async \(inputOverride\?: string, filesOverride\?: AttachedFile\[\]\)/, 'handleGenerate takes the overrides');
  });

  test('reachability: the card is mounted above the composer and wired to the queue', () => {
    assert.match(chat, /aboveComposer=\{queue\.messages\.length > 0 && messages\.length > 0 \? \(\s*<ChatQueue/);
    for (const handler of ['onToggle={toggleQueueExpansion}', 'onRemove={removeFromQueue}', 'onMove={moveInQueue}', 'onSaveText={saveQueuedText}', 'onRemoveFile={removeQueuedFile}', 'onAttach={attachToQueued}', 'onHoldChange={setIsQueueHeld}']) {
      assert.ok(chat.includes(handler), `ChatQueue gets ${handler}`);
    }
    const empty = read('ChatEmptyState.tsx');
    assert.match(empty, /data-chat-queue-slot/, 'ChatEmptyState renders the aboveComposer slot');
  });
} finally {
  await vite.close();
}
