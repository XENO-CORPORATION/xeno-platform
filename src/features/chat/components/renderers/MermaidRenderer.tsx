import React, { useEffect, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import SandboxFrame from './SandboxFrame';

/**
 * MermaidRenderer — render a mermaid diagram to an SVG STRING via the mermaid library,
 * then DISPLAY that SVG inside the SAME origin-null sandbox iframe used for svg/html
 * artifacts (SandboxFrame), rather than injecting it into the parent DOM via innerHTML.
 *
 * Why: mermaid is trusted and produces SVG (not executable), but a diagram can still
 * embed <foreignObject>/filters, and any DOMPurify/foreignObject bypass injected into
 * the PARENT via innerHTML would run in our own origin and could reach the auth token /
 * localStorage / DOM. By funnelling the produced SVG through SandboxFrame (which renders
 * it with sandbox="allow-scripts" WITHOUT allow-same-origin, i.e. a null origin), any
 * such bypass is contained in the sandbox and cannot touch the parent. DOMPurify (SVG
 * profile) stays as defense-in-depth but we DROP ADD_TAGS:['foreignObject'] — with the
 * null-origin frame doing the real containment there is no reason to widen the sanitizer.
 * mermaid + DOMPurify are dynamically imported so they stay out of the main bundle.
 *
 * Streaming: mermaid.render() throws on half-written source, and on throw it leaks a
 * temporary measurement node onto document.body. So we (1) only render once the block is
 * COMPLETE — while it streams we show a lightweight "generating" state instead of
 * throwing incomplete source at mermaid every ~400ms — and (2) remove mermaid's temp
 * nodes (#id / #d{id} / #i{id}) in a finally block regardless of success/failure.
 */
let seq = 0;

const MermaidRenderer: React.FC<{
  content: string;
  /** False while the artifact block is still streaming (closing fence not yet seen). */
  complete?: boolean;
  reloadKey?: string | number;
}> = ({ content, complete = true, reloadKey }) => {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Gate on completeness: don't throw incomplete streaming source at mermaid (it
    // parse-errors AND leaks a temp node each time). Wait for the finished diagram.
    if (!complete) {
      setSvg(null);
      setError(null);
      return;
    }

    let alive = true;
    setError(null);
    setSvg(null);
    const id = `xeno-mermaid-${(seq += 1)}`;

    (async () => {
      try {
        const [{ default: mermaid }, { default: DOMPurify }] = await Promise.all([
          import('mermaid'),
          import('dompurify'),
        ]);
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          // 'default' (light) theme so the diagram reads on the sandbox's white canvas.
          theme: 'default',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        });
        const { svg: raw } = await mermaid.render(id, content.trim());
        if (!alive) return;
        // Defense-in-depth only — the real containment is the null-origin iframe below.
        // No ADD_TAGS:['foreignObject']: keep the sanitizer surface as narrow as possible.
        const clean = DOMPurify.sanitize(raw, {
          USE_PROFILES: { svg: true, svgFilters: true },
        });
        setSvg(clean);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Failed to render diagram.');
      } finally {
        // mermaid leaves an orphaned measurement node on <body> when render throws (and
        // occasionally on success). Remove every temp node it may have created by id.
        for (const tid of [id, `d${id}`, `i${id}`]) {
          try {
            document.getElementById(tid)?.remove();
          } catch {
            /* noop */
          }
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [content, complete, reloadKey]);

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-white/50">
        <AlertTriangle size={22} className="text-amber-400/80" />
        <span className="max-w-md whitespace-pre-wrap">{error}</span>
      </div>
    );
  }

  // Still streaming — lightweight placeholder; we render the final diagram once complete.
  if (!complete) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#0d0d0f] text-sm text-white/45">
        <Loader2 size={20} className="animate-spin text-white/40" />
        <span>Generating diagram…</span>
      </div>
    );
  }

  // Complete, but the async render/import hasn't produced the SVG yet.
  if (svg == null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#0d0d0f]">
        <Loader2 size={22} className="animate-spin text-white/40" />
      </div>
    );
  }

  // Contain the rendered SVG in the SAME sandboxed (null-origin) iframe path used for
  // svg/html artifacts — never innerHTML'd into the parent document.
  return <SandboxFrame kind="svg" content={svg} reloadKey={reloadKey ?? svg.length} />;
};

export default MermaidRenderer;
