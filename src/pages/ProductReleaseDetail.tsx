import React, { useEffect, useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { Download, Loader2 } from 'lucide-react';
import ExperimentalNotice from '../components/product/ExperimentalNotice';
import { V2Page, useAccent, Eyebrow, INK, MUTED, FAINT, LINE, MONO } from '../components/product/v2/V2Page';
import { ReleaseMeta, OSES, hasAssets } from '../components/product/v2/ReleaseEntry';
import { getProduct, fetchReleases, downloadLink, type Release } from '../lib/productCatalog';
import { downloadClickHandler } from '../lib/startDownload';

/* /product/:slug/releases/:version — one release's permalink, in the v2 design
   language. A permalink is a legitimate entry point: someone can land here from a
   changelog link and download without ever seeing the product or download page,
   so the experimental notice and the gated installer links are both here. */

const ProductReleaseDetail: React.FC = () => {
  const { slug, version } = useParams();
  const product = getProduct(slug);
  const accent = useAccent(slug || '');
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!product) return;
    fetchReleases(product).then((rs) => { setReleases(rs); setLoading(false); });
  }, [product, version]);

  if (!product) return <Navigate to="/" replace />;

  const i = releases.findIndex((r) => r.version === version);
  const release = i >= 0 ? releases[i] : null;
  const newer = i > 0 ? releases[i - 1] : null;
  const older = i >= 0 && i < releases.length - 1 ? releases[i + 1] : null;

  return (
    <V2Page product={product.name}>
      <section style={{ padding: 'clamp(36px,6vh,72px) 24px 110px' }}>
        <div className="mx-auto max-w-[900px]">
          <Link to={`/product/${product.slug}/releases`} className="text-[14px] font-medium" style={{ color: MUTED }}>← All {product.name} releases</Link>

          {loading ? (
            <div className="flex justify-center py-24"><Loader2 className="h-5 w-5 animate-spin" style={{ color: FAINT }} /></div>
          ) : !release ? (
            <div className="mt-10">
              <Eyebrow color={accent.text}>Release notes</Eyebrow>
              <h1 className="mt-3 text-[clamp(36px,5vw,64px)] font-bold leading-[1] tracking-[-0.04em]">Release not found.</h1>
              <p className="mt-4 text-[17px]" style={{ color: MUTED }}>v{version} isn’t published for {product.name}.</p>
              <Link to={`/product/${product.slug}/releases`} className="mt-6 inline-block text-[15px] font-semibold" style={{ color: accent.text }}>See all releases →</Link>
            </div>
          ) : (
            <>
              <div className="mt-10">
                <Eyebrow color={accent.text}>{product.name} release notes</Eyebrow>
                <h1 style={{ fontFamily: MONO }} className="mt-3 text-[clamp(44px,6vw,84px)] font-medium leading-[1] tracking-[-0.05em]">v{release.version}</h1>
                <div className="mt-4"><ReleaseMeta release={release} latest={i === 0} accent={accent} /></div>
                {release.title && <p className="mt-6 text-[24px] font-semibold leading-[1.3] tracking-[-0.015em]">{release.title}</p>}
              </div>

              {release.notes && <div className="mt-6 whitespace-pre-line text-[17px] leading-[1.7]" style={{ color: '#3F3B35' }}>{release.notes}</div>}

              {hasAssets(release) && (
                <div className="mt-12">
                  <h2 className="m-0 text-[22px] font-bold tracking-[-0.02em]">Download v{release.version}</h2>
                  <ExperimentalNotice product={product} variant="band" tone="paper" className="mt-4" />
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {OSES.map((o) => {
                      const assets = release.assets?.[o.key] ?? [];
                      return (
                        <div key={o.key} className="rounded-[14px] bg-white p-5 shadow-[0_0_0_1px_rgba(29,27,24,.1)]" style={{ opacity: assets.length ? 1 : 0.75 }}>
                          <div className="text-[17px] font-semibold">{o.name}</div>
                          {assets.length === 0 ? <div style={{ fontFamily: MONO, color: FAINT }} className="mt-4 text-[12px]">not available</div> : assets.map((a) => (
                            <a key={a.file} href={downloadLink(product, o.key, release.version)} onClick={downloadClickHandler(product.slug, o.key, release.version)}
                              className="mt-3 flex items-center justify-center gap-2 rounded-[8px] px-4 py-2.5 text-[14.5px] font-medium transition-opacity hover:opacity-90"
                              style={{ background: INK, color: '#F6F4F0' }}>
                              <Download className="h-4 w-4" />{a.label}
                            </a>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(newer || older) && (
                <nav className="mt-14 grid grid-cols-2 gap-3" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 24 }}>
                  <div>{older && <Link to={`/product/${product.slug}/releases/${older.version}`} className="block rounded-[12px] p-4 transition-colors hover:bg-[#EFECE6]">
                    <div style={{ fontFamily: MONO, color: FAINT }} className="text-[11px] uppercase tracking-[.06em]">← Older</div>
                    <div style={{ fontFamily: MONO, color: INK }} className="mt-1 text-[16px]">v{older.version}</div></Link>}</div>
                  <div className="text-right">{newer && <Link to={`/product/${product.slug}/releases/${newer.version}`} className="block rounded-[12px] p-4 transition-colors hover:bg-[#EFECE6]">
                    <div style={{ fontFamily: MONO, color: FAINT }} className="text-[11px] uppercase tracking-[.06em]">Newer →</div>
                    <div style={{ fontFamily: MONO, color: INK }} className="mt-1 text-[16px]">v{newer.version}</div></Link>}</div>
                </nav>
              )}
            </>
          )}
        </div>
      </section>
    </V2Page>
  );
};

export default ProductReleaseDetail;
