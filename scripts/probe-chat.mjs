/*
 * One runner for the thirteen standing probes, in the shape of `test-chat.mjs`.
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

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* `needs` is the surface a probe measures on — `chat` is the product dev server on :5183, `preview`
   is the elements preview on :5223, which is where LIBRARY css has to be checked because :5183
   serves a stale copy of it. `none` reads the source only. */
const PROBES = [
  {
    file: 'probe-dead-hooks.mjs', needs: 'none',
    verdict: /unreferenced ANCHORS[^:]*: (\d+)[\s\S]*?read by nothing: (\d+)/,
    /* 19, not 20: `probe-project-settings.mjs` selects on `data-project-settings-dialog`, so that
       anchor now HAS a consumer and left the unreferenced list. The anchors exist to be selected —
       one of them finally was, and the count moving is the convention paying off rather than a
       regression. */
    expect: ['19', '3'], describe: (m) => `${m[1]} anchors kept, ${m[2]} unread state`,
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
    verdict: /already IS a variant: (\d+)/,
    expect: ['1'], describe: (m) => `${m[1]} hit (the model trigger, painted by !important)`,
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
    file: 'probe-voicebright.mjs', needs: 'chat',
    verdict: /(both routes match chat on every stop|(\d+) stop\(s\) differ)/,
    expect: ['both routes match chat on every stop'], describe: () => 'voice + search match chat at 5 stops (dark/dim/light/30%/65%)',
  },
  {
    file: 'probe-project-settings.mjs', needs: 'chat',
    verdict: /reached in (\d+) theme\(s\), worst height drift: (\d+)/,
    expect: ['2', '0'], describe: (m) => `project settings dialog reached in ${m[1]} themes, ${m[2]} height drift`,
  },
  {
    file: 'probe-open-findings.mjs', needs: 'chat',
    /* Unlike `probe-coverage`, this one is a gate. Its numbers move only when an OPEN FINDING changes
       state — a blue class added or removed, a token collision appearing, the library gaining a
       palette member — and that is precisely what someone should be told about. It caught its own
       first delta already: 15 blue utility classes became 14 when the message editor's focus ring was
       themed. */
    verdict: /blue cluster the theme does not reach\s+(\d+) utility classes \+ (\d+) literal/,
    expect: ['14', '11'], describe: (m) => `4 findings still open (${m[1]} blue classes + ${m[2]} literals)`,
  },
  {
    file: 'probe-voice-thumb.mjs', needs: 'chat',
    verdict: /inset matches at both ends: (true|false)/,
    expect: ['true'], describe: (m) => `hold-to-record inset even: ${m[1]}`,
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

const up = { chat: reachable('http://localhost:5183/'), preview: reachable('http://localhost:5223/'), none: true };

/* Report the wall clock. This suite drives a real browser eleven times and takes about four minutes,
   which is long enough that §0 asking for it every iteration is a genuine cost — better to see that
   number than be surprised by it. `npm run test:chat` is the seconds-long gate; this is the slow one,
   and knowing which is which is what stops someone quietly dropping it. */
const startedAt = Date.now();
const results = [];
for (const probe of PROBES) {
  if (!up[probe.needs]) {
    results.push({ probe, state: 'skip', note: probe.needs === 'chat' ? 'dev server :5183 is down' : 'elements preview :5223 is down' });
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
  const bad = probe.expect
    .map((want, i) => (want === null || m[i + 1] === want ? null : `#${i + 1} expected ${want}, got ${m[i + 1]}`))
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
    `${skipped.length} skipped — ${Math.round((Date.now() - startedAt) / 1000)}s.`,
);

if (skipped.length) {
  console.error('\nSkipped is not passed. Start what they need and run again:');
  console.error('  chat     npm run dev            (the user\'s server on :5183 — do not restart it)');
  console.error('  preview  cd ../xeno-elements-foundations/packages/preview && npx vite --port 5223');
}
if (failed.length) {
  console.error(`\n${failed.length} probe(s) moved. Run the one that failed directly for the detail.`);
  console.error('If the change was deliberate, update its `expect` here in the same commit — an');
  console.error('expectation edited later than the change it describes is how a baseline rots.');
  process.exit(1);
}
