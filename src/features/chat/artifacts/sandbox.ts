// sandbox.ts — build the srcDoc for the preview iframe.
//
// SECURITY INVARIANTS (do not weaken):
//  - The iframe is rendered with sandbox="allow-scripts" and NEVER allow-same-origin,
//    so the frame is origin-null: artifact code cannot reach the parent's DOM, cookies,
//    localStorage, or auth token. (The sandbox attribute lives on the <iframe> element
//    in SandboxFrame.tsx — this module only produces the document string.)
//  - A restrictive CSP <meta> is injected as defense-in-depth: default-src 'none', no
//    framing, no form posts, no base-uri hijack. Scripts/styles run inline (they are
//    already isolated by the null origin); network egress is locked down —
//    connect-src 'none' blocks fetch/XHR/WebSocket/beacon so artifact JS can't
//    exfiltrate user-entered data (see CSP_HTML below for the full rationale).
//  - referrerPolicy=no-referrer is set on the element.
//  - Links are forced to rel="noopener noreferrer" and target=_blank.
//
// Nothing here is ever eval'd or transpiled in the PARENT window.

import type { ReactRuntime } from './reactRuntime';

// Base CSP for HTML/SVG artifacts. 'unsafe-inline' is required for the artifact's own
// inline scripts/styles; the null origin + sandbox make that safe from the parent's
// perspective. default-src 'none' blocks everything else and base-uri/form-action are
// locked down.
//
// connect-src is 'none' (NOT https:) — a deliberate exfiltration control. Artifacts in
// this phase are self-contained demos that do not need network access, so we forbid
// fetch/XHR/WebSocket/EventSource/navigator.sendBeacon entirely: that closes the primary
// channel by which artifact JS could beacon user-entered data (form input, pasted
// secrets) out to an attacker. Tradeoff: an artifact that tries to call an external API
// will fail — acceptable here; revisit (per-artifact allowlist) if/when demos need it.
// img/media/font still allow https: so demos can load remote images/fonts; that leaves a
// narrow GET-only surface (e.g. new Image().src) and no way to READ a response, which we
// accept in exchange for working image-based demos.
const CSP_HTML =
  "default-src 'none'; " +
  "script-src 'unsafe-inline' 'unsafe-eval' blob:; " +
  "style-src 'unsafe-inline'; " +
  "img-src data: blob: https:; " +
  "media-src data: blob: https:; " +
  "font-src data: https:; " +
  "connect-src 'none'; " +
  "form-action 'none'; " +
  "base-uri 'none'; " +
  "frame-src 'none';";

// React artifacts additionally need eval (Babel transpile + new Function). Same host CSP.
const CSP_REACT = CSP_HTML;

function metaHead(csp: string): string {
  return (
    `<meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<meta name="referrer" content="no-referrer">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">`
  );
}

// Small guard injected into every frame: force all links to open safely, and stop the
// artifact from attempting to navigate the top frame. (Sandbox already blocks top
// navigation without allow-top-navigation; this is belt-and-suspenders + rel hygiene.)
const LINK_GUARD = `
<script>
(function(){
  function harden(a){ try{ a.setAttribute('rel','noopener noreferrer'); a.setAttribute('target','_blank'); }catch(e){} }
  document.addEventListener('click', function(e){
    var el = e.target;
    while (el && el.tagName !== 'A') el = el.parentElement;
    if (el && el.tagName === 'A') harden(el);
  }, true);
  try {
    new MutationObserver(function(muts){
      muts.forEach(function(m){ (m.addedNodes||[]).forEach(function(n){
        if (n.querySelectorAll){ n.querySelectorAll('a[href]').forEach(harden); }
        if (n.tagName === 'A') harden(n);
      }); });
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch(e){}
})();
</script>`;

/** True if the source already looks like a full HTML document. */
function isFullDocument(html: string): boolean {
  return /<html[\s>]/i.test(html) || /<!doctype/i.test(html);
}

/** Build the srcDoc for an HTML artifact (wrapping a fragment in a document if needed). */
export function buildHtmlSrcDoc(html: string): string {
  if (isFullDocument(html)) {
    // Inject our CSP + link guard right after <head> (or synthesize one).
    const withMeta = injectIntoHead(html, metaHead(CSP_HTML));
    return injectBeforeBodyEnd(withMeta, LINK_GUARD);
  }
  return (
    `<!doctype html><html><head>${metaHead(CSP_HTML)}` +
    `<style>html,body{margin:0;padding:16px;color:#111;background:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-sizing:border-box}*{box-sizing:border-box}</style>` +
    `</head><body>${html}${LINK_GUARD}</body></html>`
  );
}

/** Build the srcDoc for an SVG artifact — centered on a neutral checkerboard. */
export function buildSvgSrcDoc(svg: string): string {
  return (
    `<!doctype html><html><head>${metaHead(CSP_HTML)}` +
    `<style>html,body{margin:0;height:100%}` +
    `body{display:flex;align-items:center;justify-content:center;` +
    `background:#fff;background-image:linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%);` +
    `background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}` +
    `svg{max-width:100%;max-height:100vh}</style>` +
    `</head><body>${svg}</body></html>`
  );
}

/**
 * Build the srcDoc for a React (jsx/tsx) artifact. Babel + React + ReactDOM UMD are
 * inlined; the user's source is passed as a JSON string and transpiled + executed
 * INSIDE the frame. Rendering strategy: if the code renders into #root itself we leave
 * it; otherwise we mount a detected default/App/exported component.
 */
export function buildReactSrcDoc(source: string, rt: ReactRuntime): string {
  // Append a capture line so a top-level (un-exported) component is discoverable after
  // the module body runs. `typeof X` is safe even when X is undeclared.
  const augmented =
    source +
    `\n;try{globalThis.__ARTIFACT_COMP__=(typeof App!=='undefined'&&App)||` +
    `(typeof Main!=='undefined'&&Main)||(typeof Component!=='undefined'&&Component)||` +
    `(typeof module!=='undefined'&&module.exports&&(module.exports.default||module.exports.App))||null;}catch(e){}`;

  const userJson = JSON.stringify(augmented);

  const bootstrap = `
<script>
(function(){
  var root = document.getElementById('root');
  function fail(msg){
    root.innerHTML = '';
    var pre = document.createElement('pre');
    pre.style.cssText = 'margin:0;padding:14px;color:#ff8080;background:#1a0d0d;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word';
    pre.textContent = String(msg);
    root.appendChild(pre);
  }
  try {
    if (!window.Babel) return fail('Babel failed to load.');
    var transpiled = Babel.transform(${userJson}, {
      presets: ['env', 'react', ['typescript', { allExtensions: true, isTSX: true, onlyRemoveTypeImports: true }]],
      filename: 'artifact.tsx'
    }).code;
    var module = { exports: {} };
    var exports = module.exports;
    function require(name){
      if (name === 'react') return React;
      if (name === 'react-dom' || name === 'react-dom/client') return ReactDOM;
      throw new Error('Module not available in sandbox: ' + name);
    }
    var fn = new Function('React','ReactDOM','require','module','exports', transpiled);
    fn(React, ReactDOM, require, module, exports);
    var Comp = window.__ARTIFACT_COMP__;
    if (!root.hasChildNodes()) {
      if (Comp) {
        var el = React.createElement(Comp);
        if (ReactDOM.createRoot) ReactDOM.createRoot(root).render(el);
        else ReactDOM.render(el, root);
      } else {
        fail('No component to render. Export a default component, name it App, or render into #root yourself.');
      }
    }
  } catch (e) {
    fail((e && e.stack) || e);
  }
})();
</script>`;

  return (
    `<!doctype html><html><head>${metaHead(CSP_REACT)}` +
    `<style>html,body{margin:0;padding:0;color:#111;background:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}#root{min-height:100vh}</style>` +
    `<script>${rt.react}</script>` +
    `<script>${rt.reactDom}</script>` +
    `<script>${rt.babel}</script>` +
    `</head><body><div id="root"></div>${bootstrap}${LINK_GUARD}</body></html>`
  );
}

// ── tiny HTML head/body splicers (string-level; never parsed in the parent) ──────────
function injectIntoHead(html: string, snippet: string): string {
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, (m) => `${m}${snippet}`);
  }
  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, (m) => `${m}<head>${snippet}</head>`);
  }
  return `<head>${snippet}</head>${html}`;
}

function injectBeforeBodyEnd(html: string, snippet: string): string {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${snippet}</body>`);
  return html + snippet;
}
