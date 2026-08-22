/**
 * Turns the activation gate's 403 into a page the user can act on.
 *
 * ── WHY AN INTERCEPTOR AND NOT A CHANGE PER CALL SITE ───────────────────────
 *
 * There is no central request helper in this app — every service calls `fetch`
 * directly, in dozens of places. Handling `account_not_activated` at each one
 * means handling it at each one FOREVER, and the first new service that forgets
 * reintroduces the exact bug this fixes: an unactivated user staring at a bare
 * error while the remedy sits unread in their inbox.
 *
 * One wrapper, installed once, cannot be forgotten by code written later.
 *
 * ── THE THREE THINGS THAT MAKE IT SAFE ──────────────────────────────────────
 *
 *   1. It only inspects responses that are ALREADY 403. Everything else is
 *      returned untouched, unread, same object.
 *   2. It reads a CLONE. Reading a Response body consumes it; handing the
 *      caller a drained body would break every 403 path in the app to fix one.
 *   3. It refuses to redirect when already on the activation page, so a poll
 *      that 403s cannot bounce the page against itself.
 */

const ACTIVATION_PATH = '/auth/activate';

let installed = false;

export function installActivationInterceptor(): void {
  if (installed || typeof window === 'undefined' || !window.fetch) return;
  installed = true;

  const original = window.fetch.bind(window);

  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await original(...args);

    // Cheapest possible early-out: anything that is not a 403 is not ours.
    if (res.status !== 403) return res;

    try {
      // A clone, so the caller still receives an unread body.
      const body = await res.clone().json();
      if (body?.code === 'account_not_activated') {
        const here = window.location.pathname;
        if (here !== ACTIVATION_PATH) {
          window.location.assign(ACTIVATION_PATH);
        }
      }
    } catch {
      // A 403 with a non-JSON body is somebody else's 403. Say nothing.
    }

    return res;
  };
}

export default installActivationInterceptor;
