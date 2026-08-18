/*
 * One runner for the fourteen standing probes, in the shape of `test-chat.mjs`.
 *
 * Ten scripts that each have to be run by hand and read by eye is a check nobody runs. Worse, each
 * prints a different shape of answer — a count, a table, a list of OK/NO lines — so "are they still
 * green" was a question only someone who had read all ten could answer.
 *
 * So each probe declares a VERDICT here: a regex over its output plus what the expected capture is.
 * The runner reports pass / FAIL / skip and exits non-zero on any regression.
 *
 * Two failure modes are told apart on purpose, because they mean opposite things:
 *   FAIL  the probe ran and its number moved — a regression, or a deliberate change to record here
 *   skip  the probe could not run at all (the dev server is down, the elements preview is not up)
 * A skip is not a pass. It is printed loudly and does not make the run green on its own.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAT_ORIGIN } from './lib/chat-origin.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* `needs` is the surface a probe measures on — `chat` is the product dev server on :5183, `preview`
   is the elements preview on :5223, which is where LIBRARY css has to be checked because :5183
   serves a stale copy of it. `none` reads the source only.
 *
 * `slow: true` keeps a probe out of the default run. Timed individually, two of the fourteen are 60%
 * of the wall clock — `probe-coverage` 148s and `probe-voicebright` 112s of 432s — because one walks
 * every surface it can reach and the other loads ten pages. Everything else together is ~137s.
 *
 * They are not less important; they guard a different KIND of thing. The fast gate catches
 * correctness regressions, which is what an iteration can break by accident. Coverage and theme
 * parity move only when someone changes the walk, the tokens or the bridge — deliberate acts, and
 * `npm run probe:chat:full` belongs to those commits.
 *
 * The split exists because a seven-minute gate stops being run, and a gate nobody runs is worth less
 * than a slower one that is. */
const PROBES = [
  {
    file: 'probe-dead-hooks.mjs', needs: 'none',
    verdict: /unreferenced ANCHORS[^:]*: (\d+)[\s\S]*?read by nothing: (\d+)[\s\S]*?STILL TO DECIDE — no reason written: (\d+)/,
    /* 19, not 20: `probe-project-settings.mjs` selects on `data-project-settings-dialog`, so that
       anchor now HAS a consumer and left the unreferenced list. The anchors exist to be selected —
       one of them finally was, and the count moving is the convention paying off rather than a
       regression.

       The gate is the THIRD number, not the second. `3 unread state hooks` is a fact about the chat
       and it should never have had to reach zero — both answers this probe used to force, give it a
       consumer or delete it, turned out wrong for all three. What must stay at zero is hooks with no
       reason written, which is the finish line §3 and §7 already use: nothing unread by ACCIDENT. */
    expect: ['19', '3', '0'],
    describe: (m) => `${m[1]} anchors kept, ${m[2]} unread state each with its reason, ${m[3]} still to decide`,
  },
  {
    file: 'probe-tab-order.mjs', needs: 'chat',
    verdict: /distinct click targets a keyboard cannot reach: (\d+)/,
    expect: ['0'], describe: (m) => `${m[1]} unreachable`,
  },
  {
    file: 'probe-adopted-metrics.mjs', needs: 'chat',
    verdict: /adopted controls measured: (\d+)[\s\S]*?height differing from the size token: (\d+)[\s\S]*?radius differing from[^:]*: (\d+)/,
    expect: [null, '0', '0'], describe: (m) => `${m[1]} controls, ${m[2]} height drift, ${m[3]} radius drift`,
  },
  {
    file: 'probe-dead-normalisation.mjs', needs: 'chat',
    verdict: /normalisation selectors: (\d+)\s+matching something: (\d+)\s+matching nothing here: (\d+)/,
    expect: ['11', '10', '1'], describe: (m) => `${m[1]} selectors, ${m[2]} live, ${m[3]} dormant`,
  },
  {
    file: 'probe-variant-shapes.mjs', needs: 'chat',
    /* Two numbers, because they mean opposite things. ALL-THREE is a control tracking a variant's
       tokens — a real conversion candidate. SOME is a control riding a token collision that exists in
       one theme and not the others (§9: dark `elevated == control`, light `elevated == canvas`), and
       converting one of those fixes a theme and breaks two. SOME rising above 0 is the regression. */
    verdict: /matching a variant in ALL three themes: (\d+)[\s\S]*?matching in SOME themes only: (\d+)/,
    expect: ['1', '0'],
    describe: (m) => `${m[1]} hit in all three themes (the model trigger, painted by !important), ${m[2]} theme-only`,
  },
  {
    file: 'probe-control-fill.mjs', needs: 'chat',
    /* Reads the normalised per-theme line, not a hardcoded `rgb(38, 38, 38)`. The old verdict named
       dark's colour literally, so it would have gone silent the moment the probe learned to run in
       light — a verdict that only works in one theme is the same gap the probe was extended to close. */
    verdict: /dark hand-written fills on --chat-control: (\d+)/,
    expect: ['10'], describe: (m) => `${m[1]} hand-written control fills on --chat-control, in all three themes`,
  },
  {
    file: 'probe-invisible-fills.mjs', needs: 'chat',
    /* The `worst:` line, not the first per-theme count. This probe runs dark/dim/light and each theme
       collapses a DIFFERENT pair of tokens, so a verdict reading the first number would report dark
       and stay silent about the other two. */
    verdict: /per theme: ([^\n]+)\nworst: (\d+)/,
    expect: [null, '11'], describe: (m) => `${m[1]} — flat-on-surface (a resting tray row is meant to be)`,
  },
  {
    file: 'probe-small-targets.mjs', needs: 'chat',
    verdict: /(\d+) of (\d+) fail the target-size minimum outright/,
    expect: ['0', null], describe: (m) => `${m[1]} of ${m[2]} fail WCAG 2.2 target size`,
  },
  {
    file: 'probe-light-ink.mjs', needs: 'chat',
    verdict: /light-canvas near-white ink, worst route: (\d+)/,
    expect: ['1'], describe: (m) => `${m[1]} near-white ink on a light canvas (the caption over a dark image)`,
  },
  {
    file: 'probe-voicebright.mjs', needs: 'chat', slow: true,
    verdict: /(both routes match chat on every stop|(\d+) stop\(s\) differ)/,
    expect: ['both routes match chat on every stop'], describe: () => 'voice + search match chat at 5 stops (dark/dim/light/30%/65%)',
  },
  {
    file: 'probe-project-settings.mjs', needs: 'chat',
    verdict: /reached in (\d+) theme\(s\), worst height drift: (\d+)/,
    expect: ['2', '0'], describe: (m) => `project settings dialog reached in ${m[1]} themes, ${m[2]} height drift`,
  },
  {
    file: 'probe-coverage.mjs', needs: 'chat', slow: true,
    /*
     * A gate at last, and the shape matters: a floor on the COUNT, not the percentage.
     *
     * This was deliberately kept out of the runner because its number moves whenever a component is
     * added, and a gate that fires on healthy change teaches people to ignore gates. That reasoning
     * applied to the PERCENTAGE — add twenty Buttons to the source and it falls with nothing broken.
     * The count only falls when a surface the walk used to reach stops being reachable, which is
     * exactly a regression.
     *
     * 134, against 140 measured: enough headroom that a transient miss does not cry wolf, tight enough
     * that losing a whole page shows. The floor RISES with the baseline — otherwise it drifts into
     * meaninglessness, still green while a third of the walk has quietly stopped working.
     */
    verdict: /(\d+) rendered on the three routes/,
    /* The denominator is NOT hardcoded here any more. It read `of 255` for a while after the source
       count was corrected to 245 — a literal typed into a description is a number nobody re-measures,
       which is the same failure as a count quoted in prose. The probe prints the real one. */
    expect: [{ min: 134 }], describe: (m) => `${m[1]} adopted components rendered (floor 134)`,
  },
  {
    file: 'probe-open-findings.mjs', needs: 'chat',
    /* Unlike `probe-coverage`, this one is a gate. Its numbers move only when an OPEN FINDING changes
       state — a blue class added or removed, a token collision appearing, the library gaining a
       palette member — and that is precisely what someone should be told about. It caught its own
       first delta already: 15 blue utility classes became 14 when the message editor's focus ring was
       themed. */
    verdict: /blue cluster the theme does not reach\s+(\d+) utility classes \+ (\d+) literal/,
    /* 3, not 4: the state-hooks finding closed — not by getting the consumer it asked for, but by
       each hook getting the reason it actually had. Both answers the finding offered were wrong. */
    expect: ['14', '11'], describe: (m) => `3 findings still open (${m[1]} blue classes + ${m[2]} literals)`,
  },
  {
    file: 'probe-voice-thumb.mjs', needs: 'chat',
    verdict: /inset matches at both ends: (true|false)/,
    expect: ['true'], describe: (m) => `hold-to-record inset even: ${m[1]}`,
  },
  {
    /* Three of these had shipped before anything looked for them: `min-h-8` and `min-h-9` on the two
       settings tablists, `min-w-10` on the update carousel's counter. All three are real Tailwind
       classes from 3.4, and this repo is on 3.3.0 — so they are correct in the docs, correct in an
       editor, and generate nothing. No type error, no build error, no failing test: the control is
       just the wrong size, which reads as a design decision. */
    file: 'probe-dead-classes.mjs', needs: 'chat',
    verdict: /plain utilities written in the chat: (\d+)\s+written but NO rule generated: (\d+)/,
    expect: [{ min: 500 }, '0'],
    describe: (m) => `${m[1]} utilities checked, ${m[2]} generating no rule`,
  },
  {
    /* The first probe here that measures MOTION. Every other one reads a settled value — a height, a
       fill, a tab order — so the whole suite stayed green while a person watched the sidebar and saw
       nothing move. That gap is the reason this exists, not the bug it was written to chase: the
       animations turned out to be fine, and headless Chrome's reduced-motion default was the thing
       reporting them dead. Both traps are written into the probe's own header. */
    file: 'probe-hover-motion.mjs', needs: 'chat',
    verdict: /rows measured: (\d+)[\s\S]*?every row moves: (true|false)/,
    expect: [{ min: 6 }, 'true'], describe: (m) => `${m[1]} sidebar rows: pill travels and every glyph animates`,
  },
];

const reachable = (url) => {
  try {
    execFileSync(process.execPath, ['-e', `fetch(${JSON.stringify(url)}).then(()=>process.exit(0),()=>process.exit(1))`], {
      stdio: 'ignore', timeout: 8000,
    });
    return true;
  } catch { return false; }
};

const up = { chat: reachable(`${CHAT_ORIGIN}/`), preview: reachable('http://localhost:5223/'), none: true };

/* Report the wall clock. This suite drives a real browser eleven times and takes about four minutes,
   which is long enough that §0 asking for it every iteration is a genuine cost — better to see that
   number than be surprised by it. `npm run test:chat` is the seconds-long gate; this is the slow one,
   and knowing which is which is what stops someone quietly dropping it. */
const startedAt = Date.now();
const FULL = process.argv.includes('--full');
const selected = PROBES.filter((p) => FULL || !p.slow);
const results = [];
for (const probe of selected) {
  if (!up[probe.needs]) {
    results.push({ probe, state: 'skip', note: probe.needs === 'chat' ? `chat server ${CHAT_ORIGIN} is down` : 'elements preview :5223 is down' });
    continue;
  }
  let out = '';
  try {
    out = execFileSync(process.execPath, [path.join(HERE, probe.file)], { encoding: 'utf8', timeout: 300000 });
  } catch (e) {
    results.push({ probe, state: 'FAIL', note: `probe crashed: ${String(e.message).split('\n')[0].slice(0, 60)}` });
    continue;
  }
  const m = probe.verdict.exec(out);
  if (!m) {
    /* The probe ran and its output no longer contains the line the verdict reads. That is a change to
       the PROBE, not to the chat, and it is worth failing on: a verdict that silently stops matching
       is a green light nobody is holding. */
    results.push({ probe, state: 'FAIL', note: 'verdict line not found in output — the probe changed shape' });
    continue;
  }
  /* `expect` entries compare for equality; `min` entries are FLOORS. A floor is the right shape for a
     number that should only ever grow — it catches a regression without firing every time the thing
     it measures legitimately improves. */
  const bad = probe.expect
    .map((want, i) => {
      const got = m[i + 1];
      if (want === null) return null;
      if (typeof want === 'object' && want.min !== undefined) {
        return Number(got) >= want.min ? null : `#${i + 1} expected at least ${want.min}, got ${got}`;
      }
      return got === want ? null : `#${i + 1} expected ${want}, got ${got}`;
    })
    .filter(Boolean);
  results.push({ probe, state: bad.length ? 'FAIL' : 'pass', note: bad.length ? bad.join('; ') : probe.describe(m) });
}

for (const r of results) {
  const mark = r.state === 'pass' ? 'pass ' : r.state === 'skip' ? 'skip ' : 'FAIL ';
  console.log(`  ${mark}  ${r.probe.file.padEnd(32)} ${r.note}`);
}

const failed = results.filter((r) => r.state === 'FAIL');
const skipped = results.filter((r) => r.state === 'skip');
console.log(
  `\n${results.length - failed.length - skipped.length}/${results.length} green, ${failed.length} failing, ` +
    `${skipped.length} skipped — ${Math.round((Date.now() - startedAt) / 1000)}s.` +
    /* Name what was held back, in the run's own output. A split remembered only in a spec is a split
       that quietly becomes "the suite passes" for someone who never learns two probes did not run. */
    (PROBES.length - selected.length
      ? `  (${PROBES.length - selected.length} slow probe(s) held back — npm run probe:chat:full)`
      : ''),
);

if (skipped.length) {
  console.error('\nSkipped is not passed. Start what they need and run again:');
  console.error('  chat     npm run dev            (the user\'s server on :5183 — do not restart it)');
  console.error('  preview  cd ../xeno-elements-foundations/packages/preview && npx vite --port 5223');
  /* The escape hatch, because "do not restart it" leaves nowhere to go when it is the thing that is
     broken — which happened: installing a devDependency moved Vite's optimize-dep hash and the running
     server kept serving the old one, so the chat root stopped mounting while the route still answered
     200. A second Vite with its OWN cacheDir does not touch the first one's. */
  console.error('\n  Or run against a second server, leaving theirs alone:');
  console.error('    npx vite --config vite.probe.config.ts');
  console.error('    CHAT_ORIGIN=http://localhost:5199 npm run probe:chat');
}
if (failed.length) {
  console.error(`\n${failed.length} probe(s) moved. Run the one that failed directly for the detail.`);
  console.error('If the change was deliberate, update its `expect` here in the same commit — an');
  console.error('expectation edited later than the change it describes is how a baseline rots.');
  process.exit(1);
}
