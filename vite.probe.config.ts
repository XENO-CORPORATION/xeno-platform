import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

/**
 * A SECOND dev server, for running the probes when the first one cannot serve them.
 *
 * The probes need a running chat, and the only one is the user's own server on :5183 — the one thing
 * in this repo that must not be restarted. That was fine until installing a devDependency changed
 * `node_modules`: Vite's optimize-dep hash moved, the already-running server kept serving the old one,
 * and every request for `react-dom_client` came back `504 Outdated Optimize Dep`. The chat root stopped
 * mounting and twelve probes reported a crash — while the route still returned 200 and the module still
 * compiled. Nothing was wrong with the code and there was no way to check that.
 *
 * `cacheDir` is the whole point. A second Vite on the default cache would re-optimize into
 * `node_modules/.vite`, which is the directory the user's server is reading from — "fixing" the problem
 * by writing under a running process. This one keeps its own, so the two never meet.
 *
 *   npx vite --config vite.probe.config.ts
 *   CHAT_ORIGIN=http://localhost:5199 npm run probe:chat
 *
 * `strictPort` so a busy 5199 fails loudly rather than sliding to another port and leaving the probes
 * pointed at nothing — a silent port change and a dead server look identical from the probe's side,
 * which is the same class of mistake as §5.4d.
 */
export default mergeConfig(
  base,
  defineConfig({
    cacheDir: 'node_modules/.vite-probe',
    server: { port: 5199, strictPort: true },
  }),
);
