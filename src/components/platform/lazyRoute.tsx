import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Button, Card, ProgressBar } from '@xenosystem/elements-react';
import { useResolvedPlatformTheme } from '../../platform/platformTheme';

/** How long a route may take before anything says so. Most chunks land well inside this, and a
 * loader that flashes for a frame reads as flicker, not as progress. */
export const ROUTE_LOADING_DELAY_MS = 180;

/**
 * What a route shows while its code arrives: a thin indeterminate bar across the TOP of the content
 * area and nothing else — the way GitHub, YouTube and Linear mark a route change.
 *
 * 🔴 It used to be `<Card className="xeno">` holding `<ProgressBar label="Loading page">`. Two
 * defects, both reported 2026-09-25:
 *  - it was DARK IN LIGHT MODE. A bare `.xeno` is the elements library's dark default; light is
 *    `.xeno[data-theme='light']`, and nothing here set it. Every other element surface on the site
 *    takes the theme from the platform theme hook (ActionDialog, Notifications) — so does this, through
 *    the request-free `useResolvedPlatformTheme`, since it mounts on every route change.
 *  - it read as a stray widget: a plate-coloured card sitting where the page's content would start,
 *    captioned `Loading page —` (the em dash is the ProgressBar's percent readout for an
 *    indeterminate value). The label is kept for assistive technology and never drawn.
 */
function RouteLoading() {
  // The theme by CLASS, not by inline style: `chat-theme-<name>` carries the palette and
  // `data-theme` switches the elements library's own light block. A route fallback carries no
  // local visual values of its own (scripts/lazy-route.test.mjs).
  const { resolvedTheme } = useResolvedPlatformTheme();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), ROUTE_LOADING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return <div className={`xeno chat-themed chat-theme-${resolvedTheme} route-loading`}
    data-theme={resolvedTheme === 'light' ? 'light' : 'dark'}
    role="status" aria-busy="true" aria-live="polite" data-shown={shown || undefined}>
    {shown ? <ProgressBar value={null} /> : null}
    <span className="sr-only">Loading page</span>
  </div>;
}

class RouteLoadBoundary extends React.Component<{
  children: React.ReactNode;
  onRetry: () => void;
}, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (!this.state.failed) return this.props.children;
    return <Card className="xeno" role="alert" header="This page could not load" footer={<>
      <Button variant="secondary" onClick={this.props.onRetry} autoFocus>Try again</Button>
      <Button variant="ghost" onClick={() => window.location.reload()}>Reload page</Button>
    </>}>
      <p>Check your connection and try again. If the platform was updated, reload this page. Reloading may discard unsaved changes.</p>
    </Card>;
  }
}

/** Route-scoped loading leaves providers and surrounding workspace chrome mounted.
 * Retrying creates a new React.lazy instance (a rejected instance caches its error).
 * A document reload is offered explicitly, never triggered automatically.
 */
export function lazyRoute<T extends React.ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return function LazyRoute(props: React.ComponentProps<T>) {
    const [attempt, setAttempt] = useState(0);
    const Component = useMemo(() => React.lazy(load), [attempt]);
    return <RouteLoadBoundary key={attempt} onRetry={() => setAttempt(value => value + 1)}>
      <Suspense fallback={<RouteLoading />}>
        <Component {...props} />
      </Suspense>
    </RouteLoadBoundary>;
  };
}
