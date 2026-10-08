// The WebSocket must never run a filesystem call on a path a client sends.
// Until 2026-10-08 `file_operation` read, wrote, deleted and listed any path, for any signed-in account.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function body(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist, or this gate is checking nothing`);
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1); }
  throw new Error('unbalanced braces in ' + name);
}

test('the file_operation handler touches no file and reads no client path', () => {
  const b = body('handleFileOperation');
  assert.doesNotMatch(b, /\bfs\s*\.|\bfsp\s*\.|require\(|import\(/, 'no filesystem access in the handler');
  assert.doesNotMatch(b, /\bfilePath\b|\bmessage\.(path|content|data)\b/, 'the handler must not read a path or content from the client');
  assert.match(b, /file_operation_removed/, 'an old client is told why');
});

test('the message is still routed to that handler, so the refusal is what a client receives', () => {
  assert.match(src, /message\.type === 'file_operation'\)\s*\{\s*handleFileOperation\(ws, message\);/);
});

test('no other WebSocket message handler runs a filesystem call on a message field', () => {
  const hits = src.split('\n').map((line, i) => [i + 1, line]).filter(([, l]) => /\bfs\.(readFileSync|writeFileSync|unlinkSync|readdirSync|rmSync|mkdirSync|statSync|createReadStream|createWriteStream)\(\s*message\./.test(l));
  assert.deepEqual(hits, [], 'filesystem calls taking a socket message field: ' + JSON.stringify(hits));
});
