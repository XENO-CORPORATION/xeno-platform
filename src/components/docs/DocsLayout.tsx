import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Menu, X, ChevronRight, ArrowRight, ArrowLeft } from 'lucide-react';
import Header from '../landing-v3/Header';
import Footer from '../landing-v3/Footer';
import DocsSidebar from './DocsSidebar';
import TableOfContents from './TableOfContents';
import DocsSearch from './DocsSearch';
import DocMarkdown from './DocMarkdown';
import type { DocPage, ProductDocs } from '../../content/docs/_types';

const DocsLayout: React.FC<{ product: ProductDocs; page: DocPage; sectionTitle: string }> = ({ product, page, sectionTitle }) => {
  const navigate = useNavigate();
  const [mobileNav, setMobileNav] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const flat = useMemo(
    () => product.sections.flatMap((s) => s.pages.map((p) => ({ slug: p.slug, title: p.title }))),
    [product],
  );
  const idx = flat.findIndex((p) => p.slug === page.slug);
  const prev = idx > 0 ? flat[idx - 1] : undefined;
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : undefined;

  // ⌘K / Ctrl+K opens search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Scroll to top / anchor on page change.
  useEffect(() => {
    setMobileNav(false);
    if (window.location.hash) {
      const el = document.getElementById(window.location.hash.slice(1));
      if (el) { el.scrollIntoView(); return; }
    }
    window.scrollTo(0, 0);
  }, [page.slug]);

  return (
    <div className="flex min-h-screen flex-col bg-[#060606] text-white font-['Inter',sans-serif] overflow-x-clip antialiased">
      <Header onGetStarted={() => navigate('/login')} visible={true} />
      <DocsSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Mobile docs bar */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/[0.06] bg-[#060606]/90 px-4 py-3 backdrop-blur lg:hidden">
        <button onClick={() => setMobileNav(true)} className="inline-flex items-center gap-2 text-[13px] text-[#cdc7be]">
          <Menu className="h-4 w-4" /> Menu
        </button>
        <span className="text-[12px] text-[#5d5850]">/</span>
        <span className="truncate text-[13px] text-[#948d83]">{product.productName}</span>
      </div>

      <div className="mx-auto flex w-full max-w-[1400px] flex-1 gap-8 px-[max(16px,2vw)] pt-[76px] lg:pt-[92px]">
        {/* Left sidebar */}
        <aside className="hidden w-[250px] shrink-0 lg:block">
          <div className="sticky top-[92px] max-h-[calc(100vh-92px)] overflow-y-auto pb-16 pr-2">
            <DocsSidebar product={product} activeSlug={page.slug} onOpenSearch={() => setSearchOpen(true)} />
          </div>
        </aside>

        {/* Content */}
        <main className="min-w-0 flex-1 pb-20">
          <div className="mx-auto max-w-[820px]">
            <nav className="mb-6 flex flex-wrap items-center gap-1.5 text-[12px] text-[#69635b]">
              <Link to="/docs" className="transition-colors hover:text-[#cdc7be]">Docs</Link>
              <ChevronRight className="h-3 w-3" />
              <Link to={`/docs/${product.slug}`} className="transition-colors hover:text-[#cdc7be]">{product.productName}</Link>
              <ChevronRight className="h-3 w-3" />
              <span className="text-[#948d83]">{sectionTitle}</span>
            </nav>

            {page.description && <p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#e8e3dc]">{sectionTitle}</p>}

            <article>
              <DocMarkdown body={page.body} />
            </article>

            {/* Prev / next */}
            {(prev || next) && (
              <div className="mt-14 grid grid-cols-1 gap-3 border-t border-white/[0.06] pt-8 sm:grid-cols-2">
                {prev ? (
                  <Link to={`/docs/${product.slug}/${prev.slug}`} className="group flex flex-col rounded-[12px] border border-white/[0.07] bg-[#0d0d0d] px-4 py-3.5 transition-colors hover:border-white/[0.16]">
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-[#69635b]"><ArrowLeft className="h-3 w-3" /> Previous</span>
                    <span className="mt-1 text-[14px] font-medium text-[#cdc7be] transition-colors group-hover:text-white">{prev.title}</span>
                  </Link>
                ) : <span />}
                {next ? (
                  <Link to={`/docs/${product.slug}/${next.slug}`} className="group flex flex-col rounded-[12px] border border-white/[0.07] bg-[#0d0d0d] px-4 py-3.5 text-right transition-colors hover:border-white/[0.16]">
                    <span className="inline-flex items-center justify-end gap-1.5 text-[11px] text-[#69635b]">Next <ArrowRight className="h-3 w-3" /></span>
                    <span className="mt-1 text-[14px] font-medium text-[#cdc7be] transition-colors group-hover:text-white">{next.title}</span>
                  </Link>
                ) : <span />}
              </div>
            )}

            <div className="mt-10 flex flex-wrap gap-x-5 gap-y-2 text-[12.5px] text-[#69635b]">
              <Link to={`/product/${product.slug}`} className="transition-colors hover:text-[#cdc7be]">← {product.productName} product page</Link>
              <Link to={`/product/${product.slug}/releases`} className="transition-colors hover:text-[#cdc7be]">Release notes →</Link>
            </div>
          </div>
        </main>

        {/* Right TOC */}
        <aside className="hidden w-[200px] shrink-0 xl:block">
          <div className="sticky top-[92px] max-h-[calc(100vh-92px)] overflow-y-auto pb-16">
            <TableOfContents body={page.body} />
          </div>
        </aside>
      </div>

      {/* Mobile drawer */}
      {mobileNav && (
        <div className="fixed inset-0 z-[90] lg:hidden" onClick={() => setMobileNav(false)}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="absolute left-0 top-0 h-full w-[280px] max-w-[85vw] overflow-y-auto border-r border-white/[0.08] bg-[#0a0a0c] px-4 py-5" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setMobileNav(false)} className="mb-4 ml-auto flex h-8 w-8 items-center justify-center rounded-[7px] text-[#948d83] hover:bg-white/[0.05]">
              <X className="h-4 w-4" />
            </button>
            <DocsSidebar product={product} activeSlug={page.slug} onNavigate={() => setMobileNav(false)} onOpenSearch={() => { setMobileNav(false); setSearchOpen(true); }} />
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
};

export default DocsLayout;
