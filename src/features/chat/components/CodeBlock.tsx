import React, { useMemo, useState } from 'react';
import { Copy, Check, WrapText, ChevronDown, ChevronUp } from 'lucide-react';
import { PrismAsyncLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

// Long blocks collapse to this many lines until the reader expands them.
const COLLAPSE_THRESHOLD = 30;
const COLLAPSED_MAX_HEIGHT = 420; // px — ~30 lines at 1.55 line-height / 0.85rem

/**
 * Read-only code block with a header (language label + copy + wrap toggle + collapse
 * for long blocks). A fresh, lean version of the legacy CodeBlockWithHeader — still no
 * run/execution wiring (that is P4).
 */
const CodeBlock: React.FC<{ language?: string; code: string }> = ({ language = 'text', code }) => {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const lang = useMemo(() => (language || 'text').split(/\s+/)[0].toLowerCase(), [language]);

  const lineCount = useMemo(() => code.split('\n').length, [code]);
  const collapsible = lineCount > COLLAPSE_THRESHOLD;
  const isCollapsed = collapsible && !expanded;

  const copy = () => {
    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => {},
    );
  };

  const style = useMemo(() => {
    const s: Record<string, React.CSSProperties> = { ...(vscDarkPlus as Record<string, React.CSSProperties>) };
    s['pre[class*="language-"]'] = {
      ...(s['pre[class*="language-"]'] || {}),
      margin: 0,
      padding: '0.9rem 1rem',
      background: '#0d0d0f',
      fontSize: '0.85rem',
      lineHeight: 1.55,
      borderRadius: 0,
    };
    s['code[class*="language-"]'] = {
      ...(s['code[class*="language-"]'] || {}),
      fontFamily: "'JetBrains Mono', Consolas, Monaco, 'Ubuntu Mono', monospace",
      fontSize: '0.85rem',
    };
    return s;
  }, []);

  const HeaderButton: React.FC<{
    onClick: () => void;
    title: string;
    active?: boolean;
    children: React.ReactNode;
  }> = ({ onClick, title, active, children }) => (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors hover:bg-white/10 hover:text-white/90 ${
        active ? 'bg-white/10 text-white/90' : 'text-white/50'
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-white/10 bg-[#0d0d0f]">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-3 py-1.5">
        <span className="select-none text-[11px] font-medium uppercase tracking-wider text-white/40">
          {lang}
        </span>
        <div className="flex items-center gap-0.5">
          <HeaderButton onClick={() => setWrap((w) => !w)} title={wrap ? 'No wrap' : 'Wrap lines'} active={wrap}>
            <WrapText size={13} />
            <span className="hidden sm:inline">Wrap</span>
          </HeaderButton>
          <HeaderButton onClick={copy} title={copied ? 'Copied' : 'Copy code'}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
          </HeaderButton>
        </div>
      </div>
      <div className="relative">
        <div
          className="overflow-x-auto"
          style={isCollapsed ? { maxHeight: COLLAPSED_MAX_HEIGHT, overflowY: 'hidden' } : undefined}
        >
          <SyntaxHighlighter
            language={lang}
            style={style}
            wrapLongLines={wrap}
            // wrapLines is required for wrapLongLines to take effect per-line.
            wrapLines={wrap}
            PreTag="pre"
          >
            {code.replace(/\n$/, '')}
          </SyntaxHighlighter>
        </div>
        {isCollapsed && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0d0d0f] to-transparent" />
        )}
      </div>
      {collapsible && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex w-full items-center justify-center gap-1.5 border-t border-white/10 bg-white/[0.02] py-1.5 text-[11px] font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/90"
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? 'Show less' : `Show all ${lineCount} lines`}
        </button>
      )}
    </div>
  );
};

export default CodeBlock;
