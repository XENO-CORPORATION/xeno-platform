/*
 * A RATCHET on the type errors, not a clean bill of health.
 *
 * This repo had no typechecker. `typescript` was not in `devDependencies`, and `npx tsc` therefore
 * fetched a joke package of that name which prints a banner, reports nothing, and **exits 0** — so the
 * first attempt to check this codebase came back "0 errors, clean" and was very nearly believed. A
 * tool that cannot fail is worse than no tool: it answers the question wrongly instead of not at all.
 *
 * With the real compiler there are 556, and 77 of them are in the chat. That is not a backlog anyone
 * should clear as a side quest — it is a decision about how much of this repo's typing is worth
 * repairing, and by whom. What is NOT a decision is whether the number may quietly grow, and that is
 * all this enforces: fail if it rises, and print the count so a fall is visible too.
 *
 * A ratchet, deliberately, over the two alternatives:
 *   - a plain `tsc --noEmit` gate would be red from the first run and would be switched off within a
 *     day, which is how a repo ends up with no typechecker in the first place;
 *   - a per-file allowlist would need editing on every legitimate refactor and would rot.
 *
 * LOWER the baseline whenever the count falls. A ratchet that is never tightened is a ceiling, and a
 * ceiling with headroom is the same as no gate at all.
 *
 * One thing this CANNOT see, and it matters more than the 556: `tsconfig.json` maps only `@/*`, while
 * `vite.config.ts` also aliases `@xenosystem/*` to the element library's source. So every library
 * import in this repo resolves to nothing for tsc — 15 `TS2307`s in the chat alone — and every prop
 * passed to every adopted component is an untyped `any`. THAT is why `check-undefined-names.mjs`
 * exists: it is a runtime-identifier substitute for a typechecker that was never wired up. Adding the
 * path mapping is the real repair, and it will RAISE this number before it lowers it, because those
 * imports stop being `any`. That is an owner's call, not a sweep.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

/*
 * Measured 2026-08-18 with TypeScript 5.9.3 against tsconfig.json.
 *
 * These are LOWER than the first reading (556 / 77) while checking far MORE, which is worth stating
 * because the two numbers are not comparable as counts. The first was taken with `@xenosystem/*`
 * unresolved: every adopted component was an `any`, so none of its props were checked at all. Adding
 * the path mapping took it to 676 / 296 — the honest cost of looking — and then two things came out:
 *
 *   15 real defects, fixed. Twelve `IconButton`s with no `aria-label` at all (the library makes it
 *   REQUIRED precisely to prevent an icon-only button with no accessible name, and the requirement had
 *   never reached a call site), and three `aria-label={{searchPlaceholder}}` — a doubled brace, so an
 *   OBJECT, rendering `aria-label="[object Object]"` on three search fields.
 *
 *   244 from ONE cause. The library resolves `@types/react` 19 from its own node_modules; this app has
 *   18.2.66. Two structurally different `ReactNode`s, so every library component was "cannot be used
 *   as a JSX component". Pinning `react` / `react-dom` in `paths` is the type-level twin of the
 *   `dedupe` that `vite.config.ts` already does at runtime, and it collapses all 244.
 */
const BASELINE = 413;
const CHAT_BASELINE = 0;

/* The compiler's own entry point, run by node — not `npx tsc` through a shell. `npx` is exactly how
   this repo ended up believing it had zero type errors: with `typescript` absent it fetched a joke
   package of that name, printed a banner, and exited 0. Naming the file removes the guess, and drops
   the `shell: true` that came with it. */
const TSC = path.join(ROOT, 'node_modules/typescript/bin/tsc');
let out = '';
try {
  out = execFileSync(process.execPath, [TSC, '--noEmit', '-p', 'tsconfig.json'], {
    cwd: ROOT, encoding: 'utf8', timeout: 900000,
  });
} catch (e) {
  /* tsc exits non-zero WHENEVER there is at least one error, which here is always. Its stdout is the
     report, so a throw is the normal path and the output is what matters. */
  out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
}

const lines = out.split('\n').filter((l) => l.includes('error TS'));
const total = lines.length;
const chat = lines.filter((l) => l.includes('playground/Chat')).length;

if (!total && !/\n/.test(out)) {
  console.error('check-types: tsc produced no output at all. Is `typescript` installed?');
  console.error('A `npx tsc` that prints a banner and exits 0 is the JOKE package, not the compiler.');
  process.exit(1);
}

const byFolder = new Map();
for (const l of lines) {
  const m = /^(src[\\/][^(]*)[\\/]/.exec(l);
  const key = m ? m[1].replace(/\\/g, '/').split('/').slice(0, 3).join('/') : 'other';
  byFolder.set(key, (byFolder.get(key) ?? 0) + 1);
}

console.log(`check-types: ${total} type errors (baseline ${BASELINE}), ${chat} in the chat (baseline ${CHAT_BASELINE})\n`);
for (const [folder, n] of [...byFolder].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${String(n).padStart(4)}  ${folder}`);
}

if (total > BASELINE || chat > CHAT_BASELINE) {
  console.error(`\nType errors ROSE: ${total} vs ${BASELINE} total, ${chat} vs ${CHAT_BASELINE} in the chat.`);
  console.error('Fix what you added rather than raising the baseline — the baseline only ever goes down.');
  process.exit(1);
}
if (total < BASELINE || chat < CHAT_BASELINE) {
  console.log(`\nThe count FELL — lower the baseline in this file, in the commit that lowered it.`);
  console.log('A ratchet that is never tightened is a ceiling, and a ceiling with headroom is not a gate.');
}
