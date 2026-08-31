import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(.:)/, '$1');
const docsRoot = join(root, 'src', 'content', 'docs');
const indexSource = readFileSync(join(docsRoot, 'index.ts'), 'utf8');

const required = {
  agent: { version: '0.3.15', pages: ['introduction', 'chat-and-agent-modes', 'sessions-and-resume', 'goal-loop-handoff', 'nested-agents', 'ade-workbench', 'troubleshooting'] },
  'agent-cli': { version: '0.5.42', pages: ['introduction', 'chat-and-agent-modes', 'sessions', 'goal-loop-handoff', 'delegation', 'cli-reference', 'troubleshooting'] },
  sdk: { version: '0.9.24', pages: ['introduction', 'agent-loop', 'sessions', 'goal-loop-handoff', 'governed-automation', 'package-exports', 'versioning-stability'] },
  acp: { version: '0.2.12', pages: ['introduction', 'architecture', 'coordination-extension', 'session-lifecycle', 'agent-endpoint', 'troubleshooting'] },
  hub: { version: '0.11.18', pages: ['introduction', 'agent', 'agent-runtime-updates', 'updates', 'troubleshooting'] },
};

function parseModule(fileName) {
  const source = readFileSync(join(docsRoot, fileName), 'utf8');
  const slugs = [...source.matchAll(/["']?slug["']?\s*:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  assert.ok(slugs.length > 1, `${fileName} must declare a product slug and at least one page`);
  return { source, productSlug: slugs[0], pageSlugs: slugs.slice(1) };
}

const modules = new Map();
for (const fileName of readdirSync(docsRoot).filter((name) => name.endsWith('.ts') && !name.startsWith('_') && name !== 'index.ts')) {
  const parsed = parseModule(fileName);
  modules.set(parsed.productSlug, parsed);
}

test('released Agent-family products have registered, versioned, current documentation', () => {
  for (const [slug, contract] of Object.entries(required)) {
    const module = modules.get(slug);
    assert.ok(module, `missing docs module for ${slug}`);
    assert.match(indexSource, new RegExp(`import\\s+\\w+\\s+from\\s+['"]\\./${slug}['"]`), `${slug} is not registered`);
    assert.match(module.source, new RegExp(`["']?version["']?\\s*:\\s*['"]${contract.version.replaceAll('.', '\\.')}['"]`), `${slug} docs version is stale`);
    assert.match(module.source, /["']?updated["']?\s*:\s*['"]\d{4}-\d{2}-\d{2}['"]/, `${slug} docs need an ISO update date`);
    assert.equal(new Set(module.pageSlugs).size, module.pageSlugs.length, `${slug} has duplicate page slugs`);
    for (const page of contract.pages) assert.ok(module.pageSlugs.includes(page), `${slug} is missing required page ${page}`);
  }
});

test('Agent-family docs contain no known stale release claims', () => {
  const stale = [/currently on the \*\*0\.6\.x\*\* line/i, /shipping release \(v0\.5\.1\)/i, /desktop `0\.3\.4` is live/i, /package set.*`0\.1\.12` candidate/i];
  for (const slug of Object.keys(required)) {
    const source = modules.get(slug).source;
    for (const pattern of stale) assert.doesNotMatch(source, pattern, `${slug} contains stale release copy: ${pattern}`);
  }
});

test('Agent-family internal documentation links resolve to registered pages', () => {
  for (const slug of Object.keys(required)) {
    const source = modules.get(slug).source;
    for (const match of source.matchAll(/\/docs\/([a-z0-9-]+)\/([a-z0-9-]+)/g)) {
      const target = modules.get(match[1]);
      assert.ok(target, `${slug} links to undocumented product ${match[1]}`);
      assert.ok(target.pageSlugs.includes(match[2]), `${slug} links to missing page /docs/${match[1]}/${match[2]}`);
    }
  }
});

test('docs UI exposes product version and update metadata', () => {
  const typeSource = readFileSync(join(docsRoot, '_types.ts'), 'utf8');
  const layoutSource = readFileSync(join(root, 'src', 'components', 'docs', 'DocsLayout.tsx'), 'utf8');
  const homeSource = readFileSync(join(root, 'src', 'pages', 'DocsHome.tsx'), 'utf8');
  assert.match(typeSource, /version\?: string/);
  assert.match(typeSource, /updated\?: string/);
  assert.match(layoutSource, /Documentation updated/);
  assert.match(homeSource, /Updated \$\{p\.updated\}/);
});
