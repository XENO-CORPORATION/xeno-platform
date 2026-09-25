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

const common = { entryPoints: [join(here, 'src/index.ts')], bundle: true, platform: 'node', target: 'node20', logLevel: 'warning' };
await build({ ...common, format: 'esm', outfile: join(here, 'dist/index.js') });
await build({ ...common, format: 'cjs', outfile: join(here, 'dist/index.cjs') });

const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
execFileSync(process.execPath, [tsc, '-p', join(here, 'tsconfig.json')], { stdio: 'inherit' });
console.log('built dist/index.js, dist/index.cjs, dist/index.d.ts');
