/**
 * §5 Operational gate — "no `dangerouslySetInnerHTML` anywhere in the Forum
 * (currently true — keep it gated)."
 *
 * 🔴 THAT WORDING NAMES A MECHANISM, AND THIS FILE GATES THE OUTCOME.
 *
 * Banning one React prop does not make a renderer safe. The Forum renders user
 * markdown through `react-markdown`, and the way THAT becomes an injection
 * vector is `rehype-raw` — a plugin, not a prop, which turns embedded HTML from
 * escaped text into parsed markup. A grep for `dangerouslySetInnerHTML` returns
 * clean on a page that renders `<script>` from a stranger.
 *
 * This repo has already been burned twice by pinning mechanisms: xeno-extension
 * gated `externalUrl === undefined` (the mechanism WAS the bug), and this repo's
 * own smoke asserted "no POST anywhere" to mean read-only, which broke the day
 * MCP arrived because JSON-RPC POSTs for reads.
 *
 * So: the sink ban stays, the plugin ban is added, and then the actual property
 * is PROVEN by rendering hostile input through the real libraries at the real
 * versions and asserting no executable markup survives.
 *
 * ⚠️ SCOPE. This gates the FORUM. `rehype-raw` is a declared dependency and is
 * used elsewhere in this app — deliberately in `docs/DocMarkdown.tsx` (authored,
 * trusted content) and in the playground chat components, which render model and
 * user text. Those are outside this gate; see the report accompanying this
 * change. The Forum is the surface where one stranger's words reach every other
 * reader, which is what makes stored XSS here a different problem from a chat
 * pane rendering your own session.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (...p) => join(__dirname, '..', 'src', ...p);

const FORUM_FILES = [
  src('pages', 'ForumThread.tsx'),
  src('pages', 'Forum.tsx'),
  src('pages', 'ForumNew.tsx'),
  src('pages', 'ForumModeration.tsx'),
  src('components', 'forum', 'ForumShell.tsx'),
  src('components', 'forum', 'ForumHeader.tsx'),
  src('components', 'forum', 'NotificationBell.tsx'),
  src('components', 'forum', 'primitives.tsx'),
];

const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const FORUM_SRC = FORUM_FILES.map((f) => code(readFileSync(f, 'utf8'))).join('\n');

test('no HTML-injection sink anywhere in the Forum', () => {
  for (const sink of ['dangerouslySetInnerHTML', 'innerHTML', 'insertAdjacentHTML', 'document.write']) {
    assert.doesNotMatch(FORUM_SRC, new RegExp(sink.replace('.', '\\.')),
      `${sink} must not appear in Forum code`);
  }
});

test('🔴 rehype-raw is never wired into the Forum renderer', () => {
  // The plugin that actually matters. It is a declared dependency of this repo
  // and used elsewhere, so "we do not have it" is not the protection — "we do
  // not use it HERE" is, and that needs a gate.
  assert.doesNotMatch(FORUM_SRC, /rehype-?raw/i,
    'rehype-raw turns user markdown into parsed HTML — never in the Forum');
  assert.doesNotMatch(FORUM_SRC, /rehypePlugins/,
    'no rehype plugin at all in the Forum: the safe configuration is the one with nothing added');
});

test('the default URL sanitiser is not disabled', () => {
  // react-markdown strips javascript:/vbscript:/data: hrefs before a component
  // ever sees them. Overriding urlTransform with identity silently removes that,
  // and the diff looks like a formatting helper.
  assert.doesNotMatch(FORUM_SRC, /urlTransform/,
    'overriding urlTransform disables protocol sanitisation');
  assert.doesNotMatch(FORUM_SRC, /transformLinkUri/, 'same, older API name');
});

/** Render exactly what ForumThread renders: gfm only, no rehype plugins. */
const render = (markdown) => renderToStaticMarkup(
  React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, markdown),
);

test('🔴 hostile markdown produces no executable markup — the real renderer', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>',
    '<details open ontoggle=alert(1)>x</details>',
    '<svg/onload=alert(1)>',
    '<a href="javascript:alert(1)">click</a>',
    '[click](javascript:alert(1))',
    '[click](JaVaScRiPt:alert(1))',
    '[click](vbscript:msgbox(1))',
    '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '![img](x" onerror="alert(1))',
    '<body onload=alert(1)>',
    '<style>*{background:url("javascript:alert(1)")}</style>',
    '<math><mtext><script>alert(1)</script></mtext></math>',
  ];

  // ⚠️ ASSERT ON REAL TAGS, NOT ON THE RAW STRING.
  //
  // The first version of this test failed on `<img src=x onerror=alert(1)>`,
  // and the renderer was correct: it emits
  // `&lt;img src=x onerror=alert(1)&gt;`, which is inert TEXT. A regex for
  // ` on\w+=` matches that escaped text happily, so the gate reported an XSS in
  // a renderer that had just successfully defended against one.
  //
  // Fourth time a checker of mine has cried wolf this week. The escaped form is
  // the SUCCESS case, and any assertion that cannot tell `&lt;img` from `<img`
  // is measuring the payload rather than the output.
  const DANGEROUS_TAGS = /^(script|iframe|style|object|embed|link|meta|base|form|svg|math)$/i;

  for (const p of payloads) {
    const html = render(p);
    const tags = html.match(/<[a-zA-Z][^>]*>/g) || [];

    for (const tag of tags) {
      const name = (tag.match(/^<([a-zA-Z][\w-]*)/) || [])[1] || '';
      assert.doesNotMatch(name, DANGEROUS_TAGS, `a <${name}> element was produced by: ${p}`);
      assert.doesNotMatch(tag, /\son\w+\s*=/i, `an inline event handler survived in ${tag} — from: ${p}`);
      assert.doesNotMatch(tag, /=\s*["']?\s*(javascript|vbscript):/i,
        `a dangerous protocol survived in ${tag} — from: ${p}`);
      assert.doesNotMatch(tag, /=\s*["']?\s*data:text\/html/i,
        `a data:text/html URL survived in ${tag} — from: ${p}`);
    }
  }
});

test('...and hostile input is ESCAPED, not silently dropped', () => {
  // Escaping is the success case, and it is also the honest one: a reader (and
  // a moderator) can see exactly what was posted. Silently deleting the markup
  // would hide the attempt from the person reviewing the thread.
  const html = render('<script>alert(1)</script>');
  assert.match(html, /&lt;script&gt;/, 'the attempt should remain visible as text');
});

test('...and the check is not vacuous — the renderer really does render', () => {
  // A "no script survived" assertion also passes on a renderer that outputs
  // nothing at all. Prove it produces real markup for ordinary input, or the
  // whole test above is satisfied by breakage.
  const html = render('A **bold** word, a [link](https://example.com), and `code`.');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<a href="https:\/\/example\.com">link<\/a>/);
  assert.match(html, /<code>code<\/code>/);
});

test('a dangerous protocol becomes an INERT link, not a removed one', () => {
  // Worth pinning explicitly: the text stays visible so a reader can see what
  // was attempted, while the href is neutralised. Silently deleting the link
  // hides the attempt from the moderator looking at the thread.
  const html = render('[click](javascript:alert(1))');
  assert.match(html, />click</, 'the link text should survive');
  assert.doesNotMatch(html, /javascript:/i, 'but the protocol must not');
});
