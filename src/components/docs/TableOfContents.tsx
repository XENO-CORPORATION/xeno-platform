import React, { useEffect, useMemo, useState } from 'react';
import { extractHeadings } from './toc';

/* On-page table of contents with scroll-spy. Extracts h2/h3 from the raw
 * markdown (matching DocMarkdown's heading ids) and highlights the section
 * currently in view. */
const TableOfContents: React.FC<{ body: string }> = ({ body }) => {
  const headings = useMemo(() => extractHeadings(body, 2, 3), [body]);
  const [active, setActive] = useState('');

  useEffect(() => {
    if (headings.length === 0) return;
    const els = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length < 2) return null;

  return (
    <nav aria-label="On this page" className="text-[12.5px]">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#69635b]">On this page</div>
      <ul className="border-l border-white/[0.07]">
        {headings.map((h) => (
          <li key={h.id} style={{ paddingLeft: h.depth === 3 ? 18 : 0 }}>
            <a
              href={`#${h.id}`}
              onClick={(e) => {
                e.preventDefault();
                const el = document.getElementById(h.id);
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  history.replaceState(null, '', `#${h.id}`);
                }
              }}
              className={`-ml-px block border-l py-1 pl-3 transition-colors ${
                active === h.id
                  ? 'border-[#a760ff] text-[#cdb8ff]'
                  : 'border-transparent text-[#827b71] hover:text-[#cdc7be]'
              }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
};

export default TableOfContents;
