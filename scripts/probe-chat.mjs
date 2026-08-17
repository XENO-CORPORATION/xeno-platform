/*
 * One runner for the ten standing probes, in the shape of `test-chat.mjs`.
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
    expect: ['20', '3'], describe: (m) => `${m[1]} anchors kept, ${m[2]} unread state`,
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
    verdict: /"rgb\(38, 38, 38\)": (\d+)/,
    expect: ['10'], describe: (m) => `${m[1]} hand-written control fills at #262626`,
  },
  {
    file: 'probe-invisible-fills.mjs', needs: 'chat',
    verdict: /controls whose fill matches the surface under them: (\d+)/,
    expect: ['11'], describe: (m) => `${m[1]} flat-on-surface (resting tray rows are meant to be)`,
  },
  {
    file: 'probe-small-targets.mjs', needs: 'chat',
    verdict: /(\d+) of (\d+) fail the target-size minimum outright/,
    expect: ['0', null], describe: (m) => `${m[1]} of ${m[2]} fail WCAG 2.2 target size`,
  },
  {
    file: 'probe-voicebright.mjs', needs: 'chat',
    verdict: /(both routes match chat on every stop|(\d+) stop\(s\) differ)/,
    expect: ['both routes match chat on every stop'], describe: () => 'voice + search match chat at 5 stops (dark/dim/light/30%/65%)',
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
console.log(`\n${results.length - failed.length - skipped.length}/${results.length} green, ${failed.length} failing, ${skipped.length} skipped.`);

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
