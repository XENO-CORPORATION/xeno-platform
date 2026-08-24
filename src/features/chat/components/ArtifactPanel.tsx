import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Copy,
  Check,
  Download,
  Code2,
  Eye,
  ChevronLeft,
  ChevronRight,
  Boxes,
} from 'lucide-react';
import { PrismAsyncLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useChatStore } from '../store';
import { deriveArtifacts, extensionFor } from '../artifacts/parse';
import type { Artifact, ArtifactKind } from '../artifacts/types';
import Markdown from './Markdown';
import SandboxFrame from './renderers/SandboxFrame';
import MermaidRenderer from './renderers/MermaidRenderer';
import type { UIMessage } from '../types';

const PREVIEWABLE: ArtifactKind[] = ['html', 'svg', 'react', 'mermaid', 'document'];
// Stable empty reference (see ChatApp) — avoids the Zustand v5 getSnapshot loop guard.
const EMPTY: UIMessage[] = [];

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'artifact';
}

/** Trailing-throttle a value so the live preview refreshes at most every `ms`. */
function useThrottled<T>(value: T, ms: number, flushNow: boolean): T {
  const [out, setOut] = useState(value);
  const last = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (flushNow) {
      if (timer.current) clearTimeout(timer.current);
      last.current = Date.now();
      setOut(value);
      return;
    }
    const since = Date.now() - last.current;
    if (since >= ms) {
      last.current = Date.now();
      setOut(value);
    } else {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        last.current = Date.now();
        setOut(value);
      }, ms - since);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, ms, flushNow]);
  return out;
}

const HeaderBtn: React.FC<{
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ onClick, title, children }) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white/90"
  >
    {children}
  </button>
);

const codeStyle: Record<string, React.CSSProperties> = {
  ...(vscDarkPlus as Record<string, React.CSSProperties>),
  'pre[class*="language-"]': {
    ...((vscDarkPlus as Record<string, React.CSSProperties>)['pre[class*="language-"]'] || {}),
    margin: 0,
    padding: '1rem 1.1rem',
    background: '#0d0d0f',
    fontSize: '0.8rem',
    lineHeight: 1.6,
    borderRadius: 0,
    minHeight: '100%',
  },
};

const ArtifactPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const activeId = useChatStore((s) => s.activeId);
  const messages =
    useChatStore((s) => (s.activeId ? s.messagesByConv[s.activeId] : undefined)) ?? EMPTY;
  const activeArtifactId = useChatStore((s) => s.activeArtifactId);
  const activeVersionSel = useChatStore((s) => s.activeArtifactVersion);
  const setArtifactVersion = useChatStore((s) => s.setArtifactVersion);
  const isStreaming = useChatStore((s) => s.isStreaming);

  const artifacts = useMemo<Artifact[]>(() => deriveArtifacts(messages), [messages]);
  const artifact = useMemo(
    () => artifacts.find((a) => a.id === activeArtifactId) || null,
    [artifacts, activeArtifactId],
  );

  const versionCount = artifact?.versions.length ?? 0;
  const versionIdx =
    versionCount === 0
      ? 0
      : activeVersionSel == null
        ? versionCount - 1
        : Math.min(Math.max(activeVersionSel, 0), versionCount - 1);
  const version = artifact?.versions[versionIdx] ?? null;

  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);
  const canPreview = artifact ? PREVIEWABLE.includes(artifact.kind) : false;

  // When the target artifact changes, pick a sensible default tab: watch code stream
  // live while generating, flip to preview once it's a real (complete) previewable one.
  const lastArtifactRef = useRef<string | null>(null);
  useEffect(() => {
    if (!artifact) return;
    if (lastArtifactRef.current !== artifact.id) {
      lastArtifactRef.current = artifact.id;
      setTab(canPreview && version?.complete ? 'preview' : 'code');
    }
  }, [artifact, canPreview, version?.complete]);

  // Once a live artifact finishes streaming, reveal its preview automatically.
  const wasComplete = useRef<boolean>(true);
  useEffect(() => {
    if (version && version.complete && !wasComplete.current && canPreview) setTab('preview');
    wasComplete.current = version?.complete ?? true;
  }, [version?.complete, version, canPreview]);

  // Throttle the content fed to the live preview so we don't reload the iframe per token.
  const throttled = useThrottled(version?.content ?? '', 400, !!version?.complete || !isStreaming);

  const copy = () => {
    if (!version) return;
    navigator.clipboard.writeText(version.content).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => {},
    );
  };

  const download = () => {
    if (!artifact || !version) return;
    const ext = extensionFor(artifact.kind, artifact.lang);
    const suffix = versionCount > 1 ? `-v${versionIdx + 1}` : '';
    const blob = new Blob([version.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(artifact.title)}${suffix}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  if (!activeId || !artifact || !version) {
    return (
      <div className="flex h-full flex-col bg-[#0a0a0b]">
        <PanelHeaderShell onClose={onClose} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-white/40">
          <Boxes size={24} className="text-white/25" />
          <span>This artifact isn’t available anymore. Pick another from the thread.</span>
        </div>
      </div>
    );
  }

  const reloadKey = `${version.versionId}:${throttled.length}:${version.complete ? 'c' : 's'}`;

  return (
    <div className="flex h-full flex-col bg-[#0a0a0b]">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-white/90">{artifact.title}</div>
          <div className="truncate text-[11px] uppercase tracking-wider text-white/35">
            {artifact.lang}
          </div>
        </div>

        {/* Version switcher */}
        {versionCount > 1 && (
          <div className="flex items-center gap-0.5 rounded-lg bg-white/[0.04] px-1 py-0.5 text-white/50">
            <button
              onClick={() => setArtifactVersion(Math.max(versionIdx - 1, 0))}
              disabled={versionIdx <= 0}
              title="Previous version"
              className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/10 hover:text-white/90 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="select-none px-0.5 text-[11px] font-medium tabular-nums">
              v{versionIdx + 1}/{versionCount}
            </span>
            <button
              onClick={() => setArtifactVersion(Math.min(versionIdx + 1, versionCount - 1))}
              disabled={versionIdx >= versionCount - 1}
              title="Next version"
              className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/10 hover:text-white/90 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        <HeaderBtn onClick={copy} title={copied ? 'Copied' : 'Copy source'}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </HeaderBtn>
        <HeaderBtn onClick={download} title="Download">
          <Download size={16} />
        </HeaderBtn>
        <HeaderBtn onClick={onClose} title="Close panel">
          <X size={16} />
        </HeaderBtn>
      </div>

      {/* Tab toggle */}
      <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-2.5 py-1.5">
        <TabButton active={tab === 'preview'} disabled={!canPreview} onClick={() => setTab('preview')}>
          <Eye size={13} /> Preview
        </TabButton>
        <TabButton active={tab === 'code'} onClick={() => setTab('code')}>
          <Code2 size={13} /> Code
        </TabButton>
        {!version.complete && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-[#c99bff]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ece7df]" />
            Generating…
          </span>
        )}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'preview' && canPreview ? (
          <div className="h-full w-full">
            {(artifact.kind === 'html' || artifact.kind === 'svg' || artifact.kind === 'react') && (
              <SandboxFrame kind={artifact.kind} content={throttled} reloadKey={reloadKey} />
            )}
            {artifact.kind === 'mermaid' && (
              <MermaidRenderer
                content={throttled}
                complete={version.complete}
                reloadKey={reloadKey}
              />
            )}
            {artifact.kind === 'document' && (
              <div className="h-full overflow-y-auto px-6 py-5">
                <Markdown>{throttled}</Markdown>
              </div>
            )}
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <SyntaxHighlighter language={artifact.lang || 'text'} style={codeStyle} PreTag="pre">
              {version.content || ''}
            </SyntaxHighlighter>
          </div>
        )}
      </div>
    </div>
  );
};

const PanelHeaderShell: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-3">
    <span className="text-[13px] font-semibold text-white/70">Artifact</span>
    <HeaderBtn onClick={onClose} title="Close panel">
      <X size={16} />
    </HeaderBtn>
  </div>
);

const TabButton: React.FC<{
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, disabled, onClick, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
      active ? 'bg-white/10 text-white/90' : 'text-white/45 hover:bg-white/5 hover:text-white/75'
    }`}
  >
    {children}
  </button>
);

export default ArtifactPanel;
