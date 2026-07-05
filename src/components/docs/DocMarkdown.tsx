import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import { PrismAsyncLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Check, Copy } from 'lucide-react';
import 'katex/dist/katex.min.css';
import { slugify, nodeToText } from './toc';

/* DocMarkdown — the shared docs markdown renderer.
 * GFM + math + fenced code with syntax highlighting and a copy button.
 * Headings get stable slug ids so the on-page TOC + anchor links work.
 * Internal links (/…) route client-side; external links open in a new tab.
 * Authored, trusted content — rehype-raw is enabled (do NOT use for user input). */

function CodeBlock({ language, code }: { language?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <div className="group relative my-5 overflow-hidden rounded-[10px] border border-white/[0.08] bg-[#0b0b0d]">
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-3.5 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-[#69635b]">{language || 'text'}</span>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-[11px] text-[#948d83] transition-colors hover:bg-white/[0.06] hover:text-white"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3 w-3 text-[#5fd08a]" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={vscDarkPlus}
        customStyle={{ margin: 0, background: 'transparent', padding: '14px 16px', fontSize: '13px', lineHeight: 1.7 }}
        codeTagProps={{ style: { fontFamily: "'JetBrains Mono','Fira Code',ui-monospace,monospace" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

const heading = (Tag: 'h1' | 'h2' | 'h3' | 'h4', cls: string) =>
  function H({ children }: any) {
    const id = slugify(nodeToText(children));
    return (
      <Tag id={id} className={`scroll-mt-24 ${cls}`}>
        {children}
      </Tag>
    );
  };

const components: any = {
  h1: heading('h1', 'mt-2 mb-5 text-[clamp(1.7rem,2.6vw,2.3rem)] font-semibold tracking-[-0.01em] text-[#f1ece4]'),
  h2: heading('h2', 'mt-11 mb-4 border-t border-white/[0.06] pt-9 text-[1.35rem] font-semibold tracking-[-0.01em] text-[#eae5dc]'),
  h3: heading('h3', 'mt-8 mb-3 text-[1.05rem] font-semibold text-[#e3ded5]'),
  h4: heading('h4', 'mt-6 mb-2 text-[0.95rem] font-semibold text-[#d8d2ca]'),
  p: ({ children }: any) => <p className="my-4 text-[14.5px] leading-[1.75] text-[#b6afa5]">{children}</p>,
  a: ({ href, children }: any) => {
    if (href && (href.startsWith('/') || href.startsWith('#'))) {
      return <Link to={href} className="font-medium text-[#b69dff] underline-offset-2 transition-colors hover:text-white hover:underline">{children}</Link>;
    }
    return (
      <a href={href} target="_blank" rel="noreferrer" className="font-medium text-[#b69dff] underline-offset-2 transition-colors hover:text-white hover:underline">
        {children}
      </a>
    );
  },
  ul: ({ children }: any) => <ul className="my-4 ml-1 list-disc space-y-2 pl-5 text-[14.5px] leading-[1.7] text-[#b6afa5] marker:text-[#5d5850]">{children}</ul>,
  ol: ({ children }: any) => <ol className="my-4 ml-1 list-decimal space-y-2 pl-5 text-[14.5px] leading-[1.7] text-[#b6afa5] marker:text-[#69635b]">{children}</ol>,
  li: ({ children }: any) => <li className="pl-1">{children}</li>,
  strong: ({ children }: any) => <strong className="font-semibold text-[#e3ded5]">{children}</strong>,
  em: ({ children }: any) => <em className="italic text-[#cdc7be]">{children}</em>,
  hr: () => <hr className="my-9 border-white/[0.07]" />,
  blockquote: ({ children }: any) => (
    <blockquote className="my-5 rounded-r-[8px] border-l-2 border-[#9f6fff]/50 bg-[#9f6fff]/[0.05] py-1 pl-4 pr-3 text-[13.5px] text-[#a9a299] [&>p]:my-2">{children}</blockquote>
  ),
  table: ({ children }: any) => (
    <div className="my-6 overflow-x-auto rounded-[10px] border border-white/[0.08]">
      <table className="w-full border-collapse text-[13.5px]">{children}</table>
    </div>
  ),
  thead: ({ children }: any) => <thead className="bg-white/[0.03]">{children}</thead>,
  th: ({ children }: any) => <th className="border-b border-white/[0.08] px-4 py-2.5 text-left font-semibold text-[#cdc7be]">{children}</th>,
  td: ({ children }: any) => <td className="border-b border-white/[0.05] px-4 py-2.5 align-top text-[#a9a299]">{children}</td>,
  pre: ({ children }: any) => <>{children}</>,
  code({ className, children }: any) {
    const match = /language-(\w+)/.exec(className || '');
    const text = String(children ?? '');
    const isBlock = !!match || text.includes('\n');
    if (isBlock) {
      return <CodeBlock language={match?.[1]} code={text.replace(/\n$/, '')} />;
    }
    return <code className="rounded-[4px] bg-[#232021] px-1.5 py-0.5 text-[0.86em] text-[#f6b98b]">{children}</code>;
  },
};

const DocMarkdown: React.FC<{ body: string }> = ({ body }) => (
  <div className="doc-markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeRaw, rehypeKatex]} components={components}>
      {body}
    </ReactMarkdown>
  </div>
);

export default DocMarkdown;
