/*
 * The support page's static-HTML generator.
 *
 * Lives in scripts/lib/ and is SIDE-EFFECT FREE on purpose: prerender-products.mjs
 * calls main() at import time, so a test that imported it would run a real
 * prerender against ./dist. Importing a module executes it — that is the rule
 * this repo has already paid for once (ABSOLUTE RULE §2b). Keeping the generator
 * here is what lets scripts/support-page.test.mjs assert the OUTPUT a crawler
 * receives, rather than grepping the generator's source and hoping.
 *
 * 🔴 The output of this file is the only page on the site whose ANSWERS exist in
 * the HTML. Every other prerendered route injects <head> only. See
 * src/content/support.ts for why that distinction matters for this URL
 * specifically (it is given to Stripe and to card-network partners, whose rule
 * is that placeholder or under-construction sites are not supported).
 */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

export function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Compile + import src/content/support.ts — the same module the React page
 *  renders, so the two surfaces cannot disagree about what support says. */
export async function loadSupport() {
  const out = await build({
    entryPoints: ['src/content/support.ts'],
    bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'silent',
  });
  const tmp = join(tmpdir(), `support-${process.pid}-${Date.now()}.mjs`);
  writeFileSync(tmp, out.outputFiles[0].text);
  return import(pathToFileURL(tmp).href);
}

/* Joined with plain spaces, never escape sequences: an earlier version of this
 * generator mangled a newline escape and emitted an unparseable file. HTML does
 * not care about the whitespace and the failure mode is silent, so it is not
 * worth the risk for prettier output nobody reads. */
export function supportBodyHtml(support) {
  const {
    SUPPORT_SECTIONS, SUPPORT_EMAIL, STATEMENT_DESCRIPTOR, STATEMENT_DESCRIPTOR_LONG,
  } = support;
  const link = (l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`;
  const item = (it) => [
    `<h3>${esc(it.q)}</h3>`,
    ...it.a.map((para) => `<p>${esc(para)}</p>`),
    it.links && it.links.length ? `<p>${it.links.map(link).join(' &middot; ')}</p>` : '',
  ].filter(Boolean).join(' ');
  const section = (sec) => [
    `<section id="${esc(sec.id)}">`,
    `<h2>${esc(sec.title)}</h2>`,
    `<p>${esc(sec.blurb)}</p>`,
    ...sec.items.map(item),
    '</section>',
  ].join(' ');

  return [
    '<main>',
    '<h1>Support</h1>',
    '<p>Answers to the things people actually write in about. If you do not find it here, email us.</p>',
    '<h2>Looking at a charge you do not recognise?</h2>',
    `<p>Payments from us show as ${esc(STATEMENT_DESCRIPTOR)} or ${esc(STATEMENT_DESCRIPTOR_LONG)} on your statement. Email the date, amount and last four digits of the card and we will identify it &mdash; you do not need to raise a dispute with your bank first.</p>`,
    `<p><a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a></p>`,
    ...SUPPORT_SECTIONS.map(section),
    '<h2>Still stuck?</h2>',
    `<p>Email <a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a>. Include the email address on your account, and for anything about a payment, the date and amount.</p>`,
    '<p><a href="/forum">Forum</a> &middot; <a href="/docs">Documentation</a> &middot; <a href="/terms">Terms</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/withdrawal">Right of withdrawal</a> &middot; <a href="/impressum">Impressum</a></p>',
    '</main>',
  ].join(' ');
}

/** Inject the body into the built shell. Safe because main.tsx mounts with
 *  createRoot(), which REPLACES the container's children rather than diffing
 *  against them the way hydrateRoot() would. */
export function renderSupportBody(html, bodyHtml) {
  const root = '<div id="root"></div>';
  if (!html.includes(root)) {
    throw new Error('prerender: #root placeholder not found - cannot inject support body');
  }
  return html.replace(root, `<div id="root">${bodyHtml}</div>`);
}
