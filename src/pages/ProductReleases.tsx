import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Header from '../components/landing-v3/Header';
import Footer from '../components/landing-v3/Footer';
import { Reveal } from '../components/landing-v3/primitives';
import ReleaseFeed from '../components/product/ReleaseFeed';
import { getProduct, fetchReleases, type Release } from '../lib/productCatalog';

const ProductReleases: React.FC = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const product = getProduct(slug);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!product) return;
    fetchReleases(product).then((r) => { setReleases(r); setLoading(false); });
  }, [product]);

  if (!product) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-screen flex-col bg-[#060606] text-white font-['Inter',sans-serif] overflow-x-clip antialiased">
      <Header onGetStarted={() => navigate('/auth')} visible={true} />
      <main className="flex-1 page-gutter pt-[clamp(92px,12vh,140px)] pb-[clamp(56px,8vh,110px)]">
        <div className="mx-auto max-w-[820px]">
          <Reveal>
            <Link to={`/product/${product.slug}`} className="inline-flex items-center gap-1.5 text-[12.5px] text-[#69635b] transition-colors hover:text-[#cdc7be]">
              <ArrowLeft className="h-3.5 w-3.5" /> {product.name}
            </Link>
          </Reveal>
          <Reveal delay={60}>
            <h1 className="mt-5 text-[clamp(1.9rem,3vw,2.8rem)] font-semibold tracking-[-0.01em] text-[#ece7df]">{product.name} releases</h1>
            <p className="mt-2 text-[14px] text-[#948d83]">Every release, patch and hotfix — newest first.</p>
          </Reveal>

          <div className="mt-8">
            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-[#827b71]" /></div>
            ) : (
              <ReleaseFeed releases={releases} slug={product.slug} linkToDetail />
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default ProductReleases;
