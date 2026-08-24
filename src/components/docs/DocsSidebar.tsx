import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Search } from 'lucide-react';
import type { ProductDocs } from '../../content/docs/_types';

/* Left navigation for a product's docs: a back link, a search trigger, then the
 * section → page tree with the active page highlighted. */
const DocsSidebar: React.FC<{
  product: ProductDocs;
  activeSlug: string;
  onNavigate?: () => void;
  onOpenSearch?: () => void;
}> = ({ product, activeSlug, onNavigate, onOpenSearch }) => (
  <div className="text-[13.5px]">
    <Link
      to="/docs"
      onClick={onNavigate}
      className="mb-4 inline-flex items-center gap-1.5 px-3 text-[12px] text-[#69635b] transition-colors hover:text-[#cdc7be]"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> All docs
    </Link>

    <button
      onClick={onOpenSearch}
      className="mb-6 flex w-full items-center justify-between rounded-[8px] border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[12.5px] text-[#827b71] transition-colors hover:border-white/[0.14] hover:text-[#cdc7be]"
    >
      <span className="inline-flex items-center gap-2"><Search className="h-3.5 w-3.5" /> Search docs</span>
      <kbd className="rounded-[4px] border border-white/[0.12] px-1.5 py-0.5 font-mono text-[10px] text-[#69635b]">⌘K</kbd>
    </button>

    <div className="mb-4 px-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#e8e3dc]">{product.productName}</div>
    </div>

    {product.sections.map((section) => (
      <div key={section.title} className="mb-6">
        <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#69635b]">{section.title}</div>
        <ul className="space-y-0.5">
          {section.pages.map((page) => {
            const active = page.slug === activeSlug;
            return (
              <li key={page.slug}>
                <Link
                  to={`/docs/${product.slug}/${page.slug}`}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={`block rounded-[7px] px-3 py-1.5 transition-colors ${
                    active
                      ? 'bg-white/[0.12] font-medium text-[#d3c4ff]'
                      : 'text-[#948d83] hover:bg-white/[0.03] hover:text-[#cdc7be]'
                  }`}
                >
                  {page.title}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    ))}
  </div>
);

export default DocsSidebar;
