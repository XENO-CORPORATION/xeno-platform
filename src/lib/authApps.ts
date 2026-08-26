/* ──────────────────────────────────────────────────────────────────────
 * XENO Unified Auth — app registry (presentation mirror)
 *
 * Compatibility presentation for legacy /auth/:app links and for the brief
 * loading state before /api/oauth2/client_info returns the authoritative
 * registered name. The oauth_clients DB row remains authoritative.
 * ────────────────────────────────────────────────────────────────────── */

export interface AuthApp {
  slug: string;
  displayName: string;   // "XENO Post"
  accent: string;        // theme accent
  tagline: string;       // shown under "Authorize {displayName}"
  /**
   * Public product page, if one is actually published.
   *
   * 🔴 OPTIONAL ON PURPOSE. /product/cli returns 200 with the bare SPA shell —
   * this app answers 200 for routes that do not exist, so a status code proves
   * nothing and linking every slug blindly ships one dead link. Verified by
   * BODY SIZE against the 4311-byte shell: post/hub/pixel/motion are real
   * pages, cli is not. Omit the field rather than guess.
   */
  productPath?: string;
}

const APPS: Record<string, AuthApp> = {
  post: { slug: 'post', productPath: '/product/post', displayName: 'XENO Post', accent: '#e8e3dc', tagline: 'Authorize XENO Post to use your XENO account.' },
  cli: { slug: 'cli', productPath: '/product/agent-cli', displayName: 'XENO Agent CLI', accent: '#7ee0a0', tagline: 'XENO Agent CLI wants to sign in to your account.' },
  'agent-cli': { slug: 'agent-cli', productPath: '/product/agent-cli', displayName: 'XENO Agent CLI', accent: '#7ee0a0', tagline: 'XENO Agent CLI wants to sign in to your account.' },
  hub: { slug: 'hub', productPath: '/product/hub', displayName: 'XENO Hub', accent: '#8fb6ff', tagline: 'Authorize XENO Hub to use your XENO account.' },
  pixel: { slug: 'pixel', productPath: '/product/pixel', displayName: 'XENO Pixel', accent: '#ffffff', tagline: 'Authorize XENO Pixel to use your XENO account.' },
  motion: { slug: 'motion', productPath: '/product/motion', displayName: 'XENO Motion', accent: '#ff8fc8', tagline: 'Authorize XENO Motion to use your XENO account.' },
  sound: { slug: 'sound', productPath: '/product/sound', displayName: 'XENO Sound', accent: '#ffffff', tagline: 'Authorize XENO Sound to use your XENO account.' },
  canvas: { slug: 'canvas', productPath: '/product/canvas', displayName: 'XENO Canvas', accent: '#ffffff', tagline: 'Authorize XENO Canvas to use your XENO account.' },
  browser: { slug: 'browser', productPath: '/product/browser', displayName: 'XENO Browser', accent: '#ffffff', tagline: 'Authorize XENO Browser to use your XENO account.' },
  rt: { slug: 'rt', productPath: '/product/rt', displayName: 'XENO RT', accent: '#ffffff', tagline: 'Authorize XENO RT to use your XENO account.' },
  web: { slug: 'web', displayName: 'XENO Web', accent: '#ffffff', tagline: 'Authorize XENO Web to use your XENO account.' },
  mail: { slug: 'mail', displayName: 'XENO Mail', accent: '#ffffff', tagline: 'Authorize XENO Mail to use your XENO account.' },
  'mobile-ios': { slug: 'mobile-ios', displayName: 'XENO (iOS)', accent: '#ffffff', tagline: 'Authorize XENO on iOS to use your XENO account.' },
  'mobile-android': { slug: 'mobile-android', displayName: 'XENO (Android)', accent: '#ffffff', tagline: 'Authorize XENO on Android to use your XENO account.' },
};

/** Resolve an app slug to its branding. `xeno-post` and `post` both resolve. */
export function getAuthApp(slug?: string): AuthApp | null {
  if (!slug) return null;
  const key = slug.replace(/^xeno-/, '').toLowerCase();
  return APPS[key] ?? null;
}
