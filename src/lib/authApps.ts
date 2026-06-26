/* ──────────────────────────────────────────────────────────────────────
 * XENO Unified Auth — app registry (presentation mirror)
 *
 * Per the "XENO UNIFIED AUTH - SPEC.md": one branded /auth/:app sign-in
 * surface for every ecosystem app. This static map themes the login card
 * (the oauth_clients DB row stays authoritative for redirect/security).
 * Unknown slug → null → the page renders the generic XENO theme (never errors).
 * ────────────────────────────────────────────────────────────────────── */

export interface AuthApp {
  slug: string;          // /auth/<slug>
  displayName: string;   // "XENO Post"
  accent: string;        // theme accent
  tagline: string;       // shown under "Authorize {displayName}"
}

const APPS: Record<string, AuthApp> = {
  post: { slug: 'post', displayName: 'XENO Post', accent: '#a760ff', tagline: 'Authorize XENO Post to use your XENO account.' },
  cli: { slug: 'cli', displayName: 'XENO CLI', accent: '#7ee0a0', tagline: 'A XENO command-line tool wants to sign in to your account.' },
  hub: { slug: 'hub', displayName: 'XENO Hub', accent: '#8fb6ff', tagline: 'Authorize XENO Hub to use your XENO account.' },
  pixel: { slug: 'pixel', displayName: 'XENO Pixel', accent: '#bf85ff', tagline: 'Authorize XENO Pixel to use your XENO account.' },
  motion: { slug: 'motion', displayName: 'XENO Motion', accent: '#ff8fc8', tagline: 'Authorize XENO Motion to use your XENO account.' },
};

/** Resolve an app slug to its branding. `xeno-post` and `post` both resolve. */
export function getAuthApp(slug?: string): AuthApp | null {
  if (!slug) return null;
  const key = slug.replace(/^xeno-/, '').toLowerCase();
  return APPS[key] ?? null;
}
