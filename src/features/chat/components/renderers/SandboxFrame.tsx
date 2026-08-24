import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import type { ArtifactKind } from '../../artifacts/types';
import { buildHtmlSrcDoc, buildSvgSrcDoc, buildReactSrcDoc } from '../../artifacts/sandbox';
import { loadReactRuntime, type ReactRuntime } from '../../artifacts/reactRuntime';

/**
 * SandboxFrame — renders untrusted html / svg / react artifacts inside a locked-down
 * iframe. The iframe is sandbox="allow-scripts allow-popups" WITHOUT allow-same-origin,
 * so it runs at a null origin and cannot touch the parent's cookies, localStorage, auth
 * token, or DOM. referrerPolicy=no-referrer. See artifacts/sandbox.ts for the srcDoc +
 * CSP. React artifacts are transpiled by Babel INSIDE the frame — never in the parent.
 *
 * `allow-popups` lets in-artifact links open in a new tab (popups inherit the sandbox,
 * so they gain no privileges); links are additionally hardened to rel=noopener.
 */
const SANDBOX = 'allow-scripts allow-popups';

const SandboxFrame: React.FC<{
  kind: Extract<ArtifactKind, 'html' | 'svg' | 'react'>;
  content: string;
  /** Bump to force a fresh frame (e.g. version switch / manual reload). */
  reloadKey?: string | number;
}> = ({ kind, content, reloadKey }) => {
  const [rt, setRt] = useState<ReactRuntime | null>(null);
  const [rtError, setRtError] = useState(false);

  const needsReact = kind === 'react';

  useEffect(() => {
    if (!needsReact) return;
    let alive = true;
    setRtError(false);
    loadReactRuntime()
      .then((r) => alive && setRt(r))
      .catch(() => alive && setRtError(true));
    return () => {
      alive = false;
    };
  }, [needsReact]);

  const srcDoc = useMemo(() => {
    if (kind === 'html') return buildHtmlSrcDoc(content);
    if (kind === 'svg') return buildSvgSrcDoc(content);
    if (kind === 'react') return rt ? buildReactSrcDoc(content, rt) : null;
    return null;
  }, [kind, content, rt]);

  if (needsReact && rtError) {
    return (
      <Fallback icon="warn">
        Couldn’t load the React runtime for this preview. View the Code tab, or try again.
      </Fallback>
    );
  }

  if (srcDoc == null) {
    return (
      <Fallback icon="spin">Loading preview…</Fallback>
    );
  }

  return (
    <iframe
      key={`${kind}:${reloadKey ?? ''}`}
      title="Artifact preview"
      sandbox={SANDBOX}
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      className="h-full w-full border-0 bg-white"
    />
  );
};

const Fallback: React.FC<{ icon: 'spin' | 'warn'; children: React.ReactNode }> = ({
  icon,
  children,
}) => (
  <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#0d0d0f] px-6 text-center text-sm text-white/50">
    {icon === 'spin' ? (
      <Loader2 size={22} className="animate-spin text-white/40" />
    ) : (
      <AlertTriangle size={22} className="text-amber-400/80" />
    )}
    <span className="max-w-xs">{children}</span>
  </div>
);

export default SandboxFrame;
