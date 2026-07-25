// This file is served to the browser and is loaded unconditionally by index.html.
// SECURITY: never place provider API keys or tokens here — anything on `window`
// is visible to every visitor. All inference/media generation routes through the
// authed, metered backend (api.xenostudio.ai), which holds the provider keys.
// Add only NON-SECRET public config below.
//
// HOSTNAMES: this file is the ONLY way to repoint the shipped frontend bundle
// without rebuilding it. `import.meta.env.VITE_*` is substituted at BUILD time,
// so a Vite constant cannot serve two domains from one artifact. This file is a
// plain static asset and can be rewritten per deployment — or per host.
// `src/config/hosts.ts` reads these first, then VITE_XENO_*, then the frozen
// xenostudio.ai defaults. Leave them out entirely to keep today's behaviour.
//
//   XENO_SITE_ORIGIN:    'https://xenostudio.ai',
//   XENO_API_ORIGIN:     'https://api.xenostudio.ai',
//   XENO_UPDATES_ORIGIN: 'https://updates.xenostudio.ai',
//   XENO_SITE_HOSTNAMES: 'xenostudio.ai,www.xenostudio.ai',  // site-gate allowlist
//
window._env_ = {
  // Add non-secret public environment variables here.
};
