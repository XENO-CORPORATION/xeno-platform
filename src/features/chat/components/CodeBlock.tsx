import React, { useMemo, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { PrismAsyncLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

/**
 * Read-only code block with a language header + copy button. A fresh, lean version
 * of the legacy CodeBlockWithHeader (no Piston run wiring — that is P1+).
 */
const CodeBlock: React.FC<{ language?: string; code: string }> = ({ language = 'text', code }) => {
  const [copied, setCopied] = useState(false);
  const lang = useMemo(() => (language || 'text').split(/\s+/)[0].toLowerCase(), [language]);

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

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-white/10 bg-[#0d0d0f]">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-3 py-1.5">
        <span className="select-none text-[11px] font-medium uppercase tracking-wider text-white/40">
          {lang}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-white/50 transition-colors hover:bg-white/10 hover:text-white/90"
          title={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <div className="overflow-x-auto">
        <SyntaxHighlighter language={lang} style={style} wrapLongLines={false} PreTag="pre">
          {code.replace(/\n$/, '')}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};

export default CodeBlock;
