// Loads a classic-script core into a bare JavaScript context: the same code a browser would run, with no browser.
// Objects made inside the context have their own prototypes, so tests compare plain copies (see plain()).
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm'; import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadCore(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx, { filename: file });
  return ctx;
}

export const plain = (x) => JSON.parse(JSON.stringify(x));

// Fake ports for createHistory: an in-memory store, a settable clock and recorders for every effect.
export function fakeHistoryPorts(initial = {}) {
  const store = new Map(Object.entries(initial));
  const effects = { toasts: [], dismissed: [], refreshed: 0, persisted: 0, reloads: 0, watched: 0, errors: [] };
  let now = 1_000_000;
  let failWrites = false, attempts = 0;
  const ports = {
    kv: {
      keys: () => [...store.keys()],
      get: (k) => (store.has(k) ? store.get(k) : null),
      set: (k, v) => { attempts += 1; if (attempts > 200) throw new Error('runaway'); if (failWrites) throw new Error('storage full'); store.set(k, String(v)); },
      remove: (k) => { attempts += 1; if (attempts > 200) throw new Error('runaway'); if (failWrites) throw new Error('storage full'); store.delete(k); },
    },
    clock: { now: () => now },
    persist: () => { effects.persisted += 1; },
    reloadHooks: () => { effects.reloads += 1; },
    watch: () => { effects.watched += 1; },
    area: () => 'library',
    toast: (msg, spec) => { effects.toasts.push({ msg, spec: spec ?? null }); },
    dismiss: (id) => { effects.dismissed.push(id); },
    refresh: () => { effects.refreshed += 1; },
    logError: (err) => { effects.errors.push(err); },
  };
  return { ports, store, effects, advance: (ms) => { now += ms; }, setNow: (v) => { now = v; }, setFailWrites: (v) => { failWrites = v; }, attempts: () => attempts };
}
