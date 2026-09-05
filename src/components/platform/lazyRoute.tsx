import React, { Suspense, useMemo, useState } from 'react';
import { Button, Card, ProgressBar } from '@xenosystem/elements-react';

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
      <Suspense fallback={<Card className="xeno" role="status" aria-busy="true">
        <ProgressBar value={null} label="Loading page" />
      </Card>}>
        <Component {...props} />
      </Suspense>
    </RouteLoadBoundary>;
  };
}
