import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowUpRight, Download, Terminal, Globe } from 'lucide-react';
import Header from '../components/landing-v3/Header';
import Footer from '../components/landing-v3/Footer';
import { Reveal } from '../components/landing-v3/primitives';
import { PRODUCTS, type Product } from '../lib/productCatalog';
import { getProductContent } from '../content/products';

/* /products — the canonical product index (PRODUCT-PAGES-SPEC.md §3.1). A grid of
   every product grouped by category; replaces the legacy static products grid. */

const STATUS: Record<Product['status'], { label: string; cls: string }> = {
  shipping: { label: 'Available', cls: 'border-emerald-400/30 text-emerald-300/90' },
  beta: { label: 'Beta', cls: 'border-white/35 text-[#e8e3dc]' },
  'coming-soon': { label: 'Soon', cls: 'border-white/[0.12] text-[#948d83]' },
};
const DELIVERY_ICON: Record<Product['delivery'], React.ComponentType<{ className?: string }> | null> = {
  web: Globe, desktop: Download, cli: Terminal, soon: null,
};

function groupByCategory(products: Product[]): [string, Product[]][] {
  const order: string[] = [];
  const map = new Map<string, Product[]>();
  for (const p of products) {
    if (!map.has(p.category)) { map.set(p.category, []); order.push(p.category); }
    map.get(p.category)!.push(p);
  }
  return order.map((c) => [c, map.get(c)!]);
}

const Card: React.FC<{ p: Product }> = ({ p }) => {
  const Icon = DELIVERY_ICON[p.delivery];
  const st = STATUS[p.status];
  // A product is navigable if it's shipping/beta OR it has a rich landing (even if coming-soon).
  const hasLanding = !!getProductContent(p.slug);
  const navigable = p.status !== 'coming-soon' || hasLanding;
  const inner = (
    <div className="group flex h-full flex-col rounded-[14px] border border-white/[0.07] bg-[#0d0d0d] p-5 transition-colors hover:border-white/[0.14] hover:bg-[#101010]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-[#ece7df]">{p.name}</h3>
        {Icon && <Icon className="h-3.5 w-3.5 text-[#5d5850]" />}
      </div>
      <p className="flex-1 text-[12.5px] leading-[1.55] text-[#948d83]">{p.tagline}</p>
      <div className="mt-3.5 flex items-center justify-between">
        <span className={`rounded-[4px] border px-1.5 py-0.5 text-[10.5px] font-medium ${st.cls}`}>{st.label}</span>
        {navigable && <ArrowUpRight className="h-3.5 w-3.5 text-[#5d5850] transition-colors group-hover:text-white" />}
      </div>
    </div>
  );
  return navigable
    ? <Link to={`/product/${p.slug}`} className="block">{inner}</Link>
    : <div className="cursor-default opacity-70">{inner}</div>;
};

const ProductsIndex: React.FC = () => {
  const navigate = useNavigate();
  const groups = groupByCategory(PRODUCTS);

  return (
    <div className="flex min-h-screen flex-col bg-[#060606] text-white font-['Inter',sans-serif] overflow-x-clip antialiased">
      <Header onGetStarted={() => navigate('/login')} visible={true} />
      <main className="flex-1 page-gutter pt-[clamp(92px,12vh,140px)] pb-[clamp(56px,8vh,110px)]">
        <div className="mx-auto max-w-[1080px]">
          <Reveal>
            <h1 className="text-[clamp(2rem,3.5vw,3.2rem)] font-semibold tracking-[-0.02em] text-[#ece7df]">Products</h1>
            <p className="mt-3 max-w-[580px] text-[14px] leading-[1.6] text-[#948d83]">
              The XENO ecosystem — creative, office, agent, and developer tools, all AI-native and built to work together.
            </p>
          </Reveal>

          {groups.map(([cat, items], gi) => (
            <Reveal key={cat} delay={60 + gi * 25}>
              <section className="mt-12">
                <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.2em] text-[#756f66]">{cat}</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((p) => <Card key={p.slug} p={p} />)}
                </div>
              </section>
            </Reveal>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default ProductsIndex;
