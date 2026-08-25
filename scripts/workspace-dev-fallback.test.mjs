/**
 * Production must never invent workspaces.
 *
 * WorkspaceContext used to treat ANY list failure as "API unavailable" and
 * load DEV_WORKSPACES, defaulting to ws-team. requireActivated 403s the
 * list with account_not_activated; the client then asked for
 * /workspaces/ws-team/members and got a second, misleading 403.
 *
 * DEV_WORKSPACES is allowed only behind import.meta.env.DEV. Production
 * stays empty and keeps the API error.
 *
 * Source-only. Mutation-checked by stripping the DEV block.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTEXT = readFileSync(join(ROOT, 'src', 'contexts', 'WorkspaceContext.tsx'), 'utf8');
const ACCOUNT = readFileSync(join(ROOT, 'src', 'services', 'accountService.ts'), 'utf8');
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function extractFrom(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) return '';
  const from = src.slice(start);
  const brace = from.indexOf('{');
  if (brace === -1) return from.slice(0, 6000);
  let depth = 0;
  let inStr = null;
  let escaped = false;
  for (let i = brace; i < from.length; i++) {
    const c = from[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === '\\') {
        escaped = true;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      inStr = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return from.slice(0, i + 1);
    }
  }
  return from.slice(0, 6000);
}

function elseBranch(src) {
  const at = src.indexOf('} else {');
  return at === -1 ? '' : src.slice(at);
}

test('refreshWorkspaces production catch cannot load DEV_WORKSPACES', () => {
  const fn = extractFrom(codeOnly(CONTEXT), 'const refreshWorkspaces = useCallback');
  assert.ok(fn, 'refreshWorkspaces is missing');
  const catchAt = fn.indexOf('} catch');
  assert.ok(catchAt !== -1, 'refreshWorkspaces has no catch');
  const catchBody = fn.slice(catchAt);
  assert.match(
    catchBody,
    /if\s*\(\s*import\.meta\.env\.DEV\s*\)/,
    'DEV_WORKSPACES must be behind import.meta.env.DEV, not the default catch.',
  );
  const productionCatch = elseBranch(catchBody);
  assert.ok(productionCatch, 'production catch has no else — DEV_WORKSPACES would run for everyone');
  assert.doesNotMatch(
    productionCatch,
    /DEV_WORKSPACES/,
    'production catch still loads DEV_WORKSPACES — that is how ws-team reached the API.',
  );
  assert.match(
    productionCatch,
    /setWorkspaces\(\s*\[\s*\]\s*\)/,
    'production catch must clear workspaces, not invent them.',
  );
  assert.match(productionCatch, /setError\(/, 'production must surface the API error');
});

test('refreshMembers production catch cannot load DEV_MEMBERS', () => {
  const fn = extractFrom(codeOnly(CONTEXT), 'const refreshMembers = useCallback');
  const catchAt = fn.indexOf('} catch');
  assert.ok(catchAt !== -1, 'refreshMembers has no catch');
  const productionCatch = elseBranch(fn.slice(catchAt));
  assert.ok(productionCatch, 'refreshMembers catch has no else');
  assert.doesNotMatch(
    productionCatch,
    /DEV_MEMBERS/,
    'production members catch still invents DEV_MEMBERS.',
  );
});

test('refreshMembers does not call the API for a non-UUID id', () => {
  const fn = extractFrom(codeOnly(CONTEXT), 'const refreshMembers = useCallback');
  assert.ok(fn, 'refreshMembers is missing');
  const guard = fn.indexOf('ACCOUNT_UUID_RE.test(activeWorkspace.id)');
  const call = fn.indexOf('getWorkspaceMembers');
  assert.ok(guard !== -1, 'refreshMembers never checks ACCOUNT_UUID_RE — ws-team still hits the API');
  assert.ok(call !== -1 && guard < call, 'UUID check must precede getWorkspaceMembers');
});

test('switchWorkspace does not POST select for a non-UUID id', () => {
  const fn = extractFrom(codeOnly(CONTEXT), 'const switchWorkspace = useCallback');
  assert.ok(fn, 'switchWorkspace is missing');
  const guard = fn.indexOf('ACCOUNT_UUID_RE.test(workspaceId)');
  const call = fn.indexOf('apiSelectWorkspace');
  assert.ok(guard !== -1, 'switchWorkspace never checks ACCOUNT_UUID_RE');
  assert.ok(call !== -1 && guard < call, 'UUID check must precede apiSelectWorkspace');
});

test('apiFetch keeps code and remedy, and will not send a non-UUID workspace header', () => {
  const src = codeOnly(ACCOUNT);
  assert.match(src, /class AccountApiError/, 'AccountApiError is missing — the 403 code was being dropped');
  const fetchStart = src.indexOf('const apiFetch = async');
  const fetchEnd = src.indexOf('export const getAccountOverview');
  assert.ok(fetchStart !== -1 && fetchEnd !== -1, 'apiFetch is missing');
  const fetchFn = src.slice(fetchStart, fetchEnd);
  assert.match(fetchFn, /new AccountApiError/, 'apiFetch must throw AccountApiError so the catch can read code/remedy');
  assert.match(
    fetchFn,
    /ACCOUNT_UUID_RE\.test\(workspace\)/,
    'apiFetch must not send x-xeno-workspace: ws-team',
  );
});
