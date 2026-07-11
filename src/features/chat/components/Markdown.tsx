import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import CodeBlock from './CodeBlock';

// react-markdown v10 no longer passes an `inline` flag to the code renderer, so we
// distinguish inline code from fenced blocks by the presence of a language class
// (fenced blocks get `language-xxx`) or a newline in the content.
const components: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const raw = String(children ?? '');
    const isBlock = !!match || raw.includes('\n');
    if (isBlock) {
      return <CodeBlock language={match?.[1] || 'text'} code={raw.replace(/\n$/, '')} />;
    }
    return (
      <code
        className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.85em] text-[#e4d5ff]"
        {...props}
      >
        {children}
      </code>
    );
  },
  a({ children, href }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#bf85ff] underline decoration-[#a760ff]/40 underline-offset-2 hover:decoration-[#a760ff]"
      >
        {children}
      </a>
    );
  },
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  p: ({ children }) => <p className="my-2 leading-[1.7] first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mb-2 mt-4 text-xl font-semibold text-white first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-4 text-lg font-semibold text-white first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-base font-semibold text-white first:mt-0">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-[#a760ff]/50 pl-3 text-white/70">{children}</blockquote>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-white/10 bg-white/5 px-3 py-1.5 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-white/10 px-3 py-1.5">{children}</td>,
  hr: () => <hr className="my-4 border-white/10" />,
};

const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[15px] text-[#e7e2da]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});

export default Markdown;
