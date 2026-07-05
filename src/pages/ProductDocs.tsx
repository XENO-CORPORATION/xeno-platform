import React from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { getProductDocs, getDocPage, firstDocPage } from '../content/docs';
import DocsLayout from '../components/docs/DocsLayout';

/* /docs/:slug and /docs/:slug/:page — renders a product's documentation.
 * /docs/:slug (no page) renders the product's first page directly (no redirect
 * flash); an unknown page redirects to the first page. */
const ProductDocs: React.FC = () => {
  const { slug, page } = useParams();
  const product = getProductDocs(slug);
  if (!product) return <Navigate to="/docs" replace />;

  const pageSlug = page || firstDocPage(product.slug)?.slug;
  const found = pageSlug ? getDocPage(product.slug, pageSlug) : undefined;
  if (!found) {
    const first = firstDocPage(product.slug);
    return first ? <Navigate to={`/docs/${product.slug}/${first.slug}`} replace /> : <Navigate to="/docs" replace />;
  }

  return <DocsLayout product={product} page={found.page} sectionTitle={found.sectionTitle} />;
};

export default ProductDocs;

/* /product/:slug/docs → /docs/:slug (canonical docs live under /docs). */
export const ProductDocsRedirect: React.FC = () => {
  const { slug } = useParams();
  return <Navigate to={`/docs/${slug || ''}`} replace />;
};
