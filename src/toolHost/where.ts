/**
 * Where XENO Tools is being served from. Its own address is tools.xenosystem.ai (owner, 2026-10-28): the picker at
 * `/` and a tool at `/<id>`, signed in through the platform's host sign-in (/api/auth/host/start). The same page also
 * still answers at xenosystem.ai/tools[/<id>] (and inside the workspace's frame as /tool-host.html).
 */
export const onToolsHost = /^tools?\.xenosystem\.ai$/i.test(location.hostname);
/** The picker's path on this host. */
export const toolsHome = onToolsHost ? '/' : '/tools';
/** One tool's path on this host. */
export const toolPath = (id: string) => (onToolsHost ? '/' : '/tools/') + encodeURIComponent(id);
/** A page of the main site (the workspace, settings): the same path here, the full address from the tools host. */
export const siteUrl = (path: string) => (onToolsHost ? 'https://xenosystem.ai' + path : path);
/** Sign in, then come back to `returnTo` on this host. */
export const signInUrl = (returnTo: string) => (onToolsHost
  ? '/api/auth/host/start?return=' + encodeURIComponent(returnTo)
  : '/login?returnUrl=' + encodeURIComponent(returnTo));
/** The tool named by the address, or '' on the picker. */
export function toolIdFromPath(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const seg = onToolsHost ? parts[0] : parts[0] === 'tools' ? parts[1] : '';
  try { return decodeURIComponent(seg || ''); } catch { return ''; }
}
/** Whether this page load is the tools site (picker or a full-page tool), as opposed to the workspace's frame. */
export const onSitePath = (pathname: string) => onToolsHost || /^\/tools(\/|$)/.test(pathname);
/** A tool the person made (an artifact of kind 'tool'), at /mine/<artifact id> on the tools host. */
export const mineToolPath = (artifactId: string) => (onToolsHost ? '/mine/' : '/tools/mine/') + encodeURIComponent(artifactId);
export function mineIdFromPath(pathname: string): string {
  const m = pathname.match(onToolsHost ? /^\/mine\/([A-Za-z0-9_-]{1,64})$/ : /^\/tools\/mine\/([A-Za-z0-9_-]{1,64})$/);
  return m ? m[1] : '';
}
/** The platform's CSRF value for a signed-in POST (the double-submit cookie the browser session sets). */
export function csrfToken(): string {
  const m = document.cookie.match(/(?:^|; )(?:__Host-)?xeno_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
