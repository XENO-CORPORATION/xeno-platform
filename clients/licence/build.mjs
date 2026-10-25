/**
 * Build @xenosystem/licence: ESM + CJS bundles and declarations.
 *
 * Both formats because the consumers are Electron MAIN processes, and several of them (Canvas)
 * bundle their main as CJS. An ESM-only package works there only if every consumer remembers to
 * bundle it rather than externalize it — the exact ERR_PACKAGE_PATH_NOT_EXPORTED trap Canvas hit
 * with the Agent packages. Shipping `require` removes the trap instead of documenting it.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
rmSync(join(here, 'dist'), { recursive: true, force: true });

const common = { bundle: true, platform: 'node', target: 'node20', logLevel: 'warning' };
// `door` bundles its own copy of the licence check, so an app importing only the door gets one module graph.
for (const [entry, out] of [['src/index.ts', 'dist/index'], ['src/door/index.ts', 'dist/door']]) {
  await build({ ...common, entryPoints: [join(here, entry)], format: 'esm', outfile: join(here, `${out}.js`) });
  await build({ ...common, entryPoints: [join(here, entry)], format: 'cjs', outfile: join(here, `${out}.cjs`) });
}

const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
execFileSync(process.execPath, [tsc, '-p', join(here, 'tsconfig.json')], { stdio: 'inherit' });
console.log('built dist/index.{js,cjs,d.ts} and dist/door.{js,cjs} + dist/door/index.d.ts');
