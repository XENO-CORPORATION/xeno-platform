import type { ProductDocs, DocPage, DocRoute } from './_types';
import agent from './agent';
import agentCli from './agent-cli';
import hub from './hub';
import sdk from './sdk';
import pixel from './pixel';
import motion from './motion';
import comms from './comms';
import canvas from './canvas';
import rt from './rt';
import post from './post';
import acp from './acp';
import sound from './sound';
import workflow from './workflow';
import architect from './architect';
import form from './form';
import engine from './engine';

/* Registry of product documentation. A product listed here gets a full docs
 * section at /docs/<slug>; products NOT here show "coming soon" on the hub.
 * Add a product = author src/content/docs/<slug>.ts and import it here. */
const MODULES: ProductDocs[] = [agent, agentCli, hub, sdk, acp, pixel, motion, comms, canvas, rt, post, sound, workflow, architect, form, engine];

const BY_SLUG = new Map(MODULES.map((m) => [m.slug, m]));

export function getProductDocs(slug?: string): ProductDocs | undefined {
  return slug ? BY_SLUG.get(slug) : undefined;
}

/** Find a specific page (and the section it lives in) within a product's docs. */
export function getDocPage(
  slug: string,
  pageSlug: string,
): { page: DocPage; sectionTitle: string } | undefined {
  const pd = BY_SLUG.get(slug);
  if (!pd) return undefined;
  for (const s of pd.sections) {
    const page = s.pages.find((p) => p.slug === pageSlug);
    if (page) return { page, sectionTitle: s.title };
  }
  return undefined;
}

/** First page of a product's docs — the landing page for /docs/<slug>. */
export function firstDocPage(slug: string): DocPage | undefined {
  return BY_SLUG.get(slug)?.sections[0]?.pages[0];
}

/** All products that have documentation (for the hub + prerender). */
export function allDocProducts(): ProductDocs[] {
  return MODULES;
}

export const DOCUMENTED_SLUGS = MODULES.map((m) => m.slug);

/** Every doc page flattened — drives the SEO prerender and the search index. */
export function allDocRoutes(): DocRoute[] {
  const routes: DocRoute[] = [];
  for (const m of MODULES) {
    for (const s of m.sections) {
      for (const p of s.pages) {
        routes.push({
          productSlug: m.slug,
          productName: m.productName,
          sectionTitle: s.title,
          pageSlug: p.slug,
          title: p.title,
          description: p.description,
          body: p.body,
        });
      }
    }
  }
  return routes;
}

export type { ProductDocs, DocPage, DocSection, DocRoute } from './_types';
