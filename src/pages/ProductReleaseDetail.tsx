import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, AlertTriangle } from 'lucide-react';
import Header from '../components/landing-v3/Header';
import Footer from '../components/landing-v3/Footer';
import { Reveal } from '../components/landing-v3/primitives';
import ExperimentalNotice from '../components/product/ExperimentalNotice';
import { getProduct, fetchReleases, downloadLink, type Release } from '../lib/productCatalog';
import { downloadClickHandler } from '../lib/startDownload';

const PLATFORMS: { key: 'windows' | 'mac' | 'linux'; name: string }[] = [
  { key: 'windows', name: 'Windows' }, { key: 'mac', name: 'macOS' }, { key: 'linux', name: 'Linux' },
];

const ProductReleaseDetail: React.FC = () => {
  const { slug, version } = useParams();
  const navigate = useNavigate();
  const product = getProduct(slug);
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!product) return;
    fetchReleases(product).then((rs) => {
      setRelease(rs.find((r) => r.version === version) ?? null);
      setLoading(false);
    });
  }, [product, version]);

  if (!product) return <Navigate to="/" replace />;

  const isHotfix = release?.type === 'hotfix';
  return (
    <div className="flex min-h-screen flex-col bg-[#060606] text-white font-['Inter',sans-serif] overflow-x-clip antialiased">
      <Header onGetStarted={() => navigate('/login')} visible={true} />
      <main className="flex-1 page-gutter pt-[clamp(92px,12vh,140px)] pb-[clamp(56px,8vh,110px)]">
        <div className="mx-auto max-w-[760px]">
          <Reveal>
            <Link to={`/product/${product.slug}/releases`} className="inline-flex items-center gap-1.5 text-[12.5px] text-[#69635b] transition-colors hover:text-[#cdc7be]">
              <ArrowLeft className="h-3.5 w-3.5" /> All {product.name} releases
            </Link>
          </Reveal>

          {loading ? (
            <div className="flex justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-[#827b71]" /></div>
          ) : !release ? (
            <Reveal delay={60}>
              <h1 className="mt-6 text-[clamp(1.8rem,3vw,2.6rem)] font-semibold text-[#ece7df]">Release not found</h1>
              <p className="mt-2 text-[14px] text-[#948d83]">v{version} isn't published for {product.name}.</p>
              <Link to={`/product/${product.slug}/releases`} className="mt-5 inline-block text-[13px] text-[#e8e3dc] hover:text-white">See all releases →</Link>
            </Reveal>
          ) : (
            <>
              <Reveal delay={60}>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <h1 className="text-[clamp(1.9rem,3.2vw,3rem)] font-semibold tracking-[-0.01em] text-[#ece7df]">{product.name} v{release.version}</h1>
                  {isHotfix && <span className="inline-flex items-center gap-1 rounded-[4px] border border-[#ff6b6b]/30 bg-[#ff6b6b]/[0.08] px-2 py-0.5 text-[11px] font-semibold uppercase text-[#ff8585]"><AlertTriangle className="h-3 w-3" />Hotfix</span>}
                </div>
                <p className="mt-2 text-[13px] text-[#69635b]">{release.date}{release.channel === 'beta' ? ' · Beta channel' : ''}</p>
              </Reveal>

              <Reveal delay={120}>
                <div className="mt-7 whitespace-pre-line text-[14.5px] leading-[1.7] text-[#b6afa5]">{release.notes}</div>
              </Reveal>

              {release.assets && (
                <Reveal delay={160}>
                  {/* A permalink is a legitimate entry point — someone can land
                      here from a changelog link and download without ever
                      seeing the product or download page. */}
                  <div className="mt-9">
                    <ExperimentalNotice product={product} variant="line" className="mb-3" />
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                      {PLATFORMS.map((p) => {
                        const assets = release.assets?.[p.key] ?? [];
                        return (
                          <div key={p.key} className="rounded-[12px] border border-white/[0.07] bg-[#0d0d0d] p-4">
                            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-[#69635b]">{p.name}</div>
                            {assets.length === 0 ? <p className="text-[12.5px] italic text-[#5d5850]">Not available</p> : assets.map((a) => (
                              <a key={a.file} href={downloadLink(product, p.key, release.version)} onClick={downloadClickHandler(product.slug, p.key, release.version)} className="group flex items-center justify-between py-1.5 text-[13px] text-[#9b948a] transition-colors hover:text-white">
                                {a.label}<Download className="h-3.5 w-3.5 text-[#5d5850] transition-colors group-hover:text-white" />
                              </a>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </Reveal>
              )}
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default ProductReleaseDetail;
