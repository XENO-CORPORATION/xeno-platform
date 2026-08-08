import React from 'react';
import { useParams, useNavigate, Link, Navigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import Header from '../components/landing-v3/Header';
import Footer from '../components/landing-v3/Footer';
import { Reveal } from '../components/landing-v3/primitives';
import { getProduct } from '../lib/productCatalog';
import { getProductContent } from '../content/products';

/* ProductPrivacy — /product/<slug>/privacy (PRODUCT-PAGES-SPEC §2).
 *
 * A product-specific privacy policy, authored in the product's content module
 * as `privacy`. It exists because a web-store listing needs a stable public URL
 * for a policy describing what THAT product does with your data, which for the
 * browser extension (it reads page content and can send it to a provider you
 * chose) is materially more than the platform policy at /privacy covers.
 *
 * Fallback is deliberate: a product with no `privacy` block redirects to the
 * platform policy rather than 404ing or rendering an empty page, so the URL is
 * never a dead end if someone links it before the content is authored. */
const ProductPrivacy: React.FC = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const product = getProduct(slug);
  const content = product ? getProductContent(product.slug) : undefined;
  const privacy = content?.privacy;

  if (!product) return <Navigate to="/" replace />;
  // Authored policy absent → the platform-wide policy is the truthful answer.
  if (!privacy) return <Navigate to="/privacy" replace />;

  return (
    <div className="flex min-h-screen flex-col bg-[#060606] text-white font-['Inter',sans-serif] overflow-x-clip antialiased">
      <Header onGetStarted={() => navigate('/auth')} visible={true} />
      <main className="flex-1 page-gutter pt-[clamp(92px,12vh,140px)] pb-[clamp(56px,8vh,110px)]">
        <div className="mx-auto max-w-[820px]">
          <Reveal>
            <Link
              to={`/product/${product.slug}`}
              className="inline-flex items-center gap-1.5 text-[12.5px] text-[#69635b] transition-colors hover:text-[#cdc7be]"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> {product.name}
            </Link>
          </Reveal>

          <Reveal delay={60}>
            <h1 className="mt-5 text-[clamp(1.9rem,3vw,2.8rem)] font-semibold tracking-[-0.01em] text-[#ece7df]">
              {product.name} privacy policy
            </h1>
            <p className="mt-2 text-[13px] text-[#69635b]">
              Last updated <time dateTime={privacy.updated}>{privacy.updated}</time>
            </p>
            <p className="mt-5 text-[15px] leading-relaxed text-[#a8a197]">{privacy.intro}</p>
          </Reveal>

          <div className="mt-12 space-y-11">
            {privacy.sections.map((section, i) => (
              <Reveal key={section.heading} delay={80 + i * 40}>
                <section>
                  <h2 className="text-[17px] font-semibold tracking-[-0.005em] text-[#ece7df]">
                    {section.heading}
                  </h2>
                  {section.body && (
                    <p className="mt-3 text-[14.5px] leading-relaxed text-[#948d83]">{section.body}</p>
                  )}
                  {section.bullets && (
                    <ul className="mt-4 space-y-3">
                      {section.bullets.map((b) => (
                        <li key={b.text} className="flex gap-3 text-[14.5px] leading-relaxed text-[#948d83]">
                          <span aria-hidden="true" className="mt-[9px] h-1 w-1 flex-none rounded-full bg-[#4a453f]" />
                          <span>
                            {b.term && <strong className="font-medium text-[#cdc7be]">{b.term}</strong>}
                            {b.term ? ' ' : ''}
                            {b.text}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {section.footnote && (
                    <p className="mt-4 text-[14.5px] leading-relaxed text-[#948d83]">{section.footnote}</p>
                  )}
                </section>
              </Reveal>
            ))}

            <Reveal delay={80 + privacy.sections.length * 40}>
              <section className="border-t border-white/[0.06] pt-8">
                <h2 className="text-[17px] font-semibold tracking-[-0.005em] text-[#ece7df]">Contact</h2>
                <p className="mt-3 text-[14.5px] leading-relaxed text-[#948d83]">
                  Questions about this policy:{' '}
                  <a
                    href={`mailto:${privacy.contact}`}
                    className="text-[#cdc7be] underline decoration-white/20 underline-offset-2 transition-colors hover:text-white"
                  >
                    {privacy.contact}
                  </a>
                </p>
                <p className="mt-4 text-[13px] leading-relaxed text-[#69635b]">
                  This policy covers {product.name} specifically. The privacy policy for XENO accounts
                  and the wider platform is at{' '}
                  <Link to="/privacy" className="underline decoration-white/15 underline-offset-2 hover:text-[#cdc7be]">
                    /privacy
                  </Link>
                  .
                </p>
              </section>
            </Reveal>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default ProductPrivacy;
