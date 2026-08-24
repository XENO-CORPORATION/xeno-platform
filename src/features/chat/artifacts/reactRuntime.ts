// reactRuntime.ts — lazily load the React + Babel UMD sources as raw strings so they
// can be INLINED into the sandboxed artifact iframe.
//
// Why inline (not <script src>)? The preview iframe is origin-null (sandbox with NO
// allow-same-origin) under a strict CSP. Inlining keeps everything self-contained,
// works offline, and — critically — the transpile + execute happen INSIDE the frame,
// never in the parent window. These are code-split into their own chunk (dynamic
// import) and only fetched the first time a React artifact is opened.
//
// Vite's `?raw` suffix ships each file's source text as a string.

let cache: Promise<ReactRuntime> | null = null;

export interface ReactRuntime {
  react: string;
  reactDom: string;
  babel: string;
}

export function loadReactRuntime(): Promise<ReactRuntime> {
  if (!cache) {
    // Reference the UMD bundles by relative filesystem path rather than the bare package
    // specifier: React 18's package `exports` map does not expose `./umd/*`, so a bare
    // `react/umd/...?raw` import fails to resolve. A relative path bypasses the exports
    // gate and Rollup/Vite reads the file directly (code-split into a lazy chunk).
    cache = Promise.all([
      import('../../../../node_modules/react/umd/react.production.min.js?raw'),
      import('../../../../node_modules/react-dom/umd/react-dom.production.min.js?raw'),
      import('../../../../node_modules/@babel/standalone/babel.min.js?raw'),
    ])
      .then(([react, reactDom, babel]) => ({
        react: react.default,
        reactDom: reactDom.default,
        babel: babel.default,
      }))
      .catch((err) => {
        cache = null; // allow a retry on transient chunk-load failure
        throw err;
      });
  }
  return cache;
}
