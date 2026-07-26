import type { ProductContent } from './_types';
import comms from './comms';
import agentCli from './agent-cli';
import pixel from './pixel';
import post from './post';
import canvas from './canvas';
import motion from './motion';
import hub from './hub';
import extension from './extension';
import workflow from './workflow';
import acp from './acp';
import sdk from './sdk';
import docs from './docs';
import notes from './notes';
import use from './use';
import rt from './rt';
import engine from './engine';
import architect from './architect';
import sound from './sound';
import browser from './browser';
import threeD from './3d';
import photo from './photo';
import anima from './anima';
import shell from './shell';

/* Registry of rich landing-page content modules. A product listed here renders
 * the full ProductLanding; any product NOT here falls back to the lean
 * ProductPage (PRODUCT-LANDING-SPEC L3). Add a product = author its module and
 * import it here. */
const MODULES: ProductContent[] = [comms, agentCli, pixel, post, canvas, motion, hub, extension, workflow, acp, sdk, docs, notes, use, engine, rt, architect, sound, browser, threeD, photo, anima, shell];

const BY_SLUG = new Map(MODULES.map((m) => [m.slug, m]));

export function getProductContent(slug?: string): ProductContent | undefined {
  return slug ? BY_SLUG.get(slug) : undefined;
}

/** Slugs that have a rich landing page (used by the prerender for SEO). */
export const RICH_PRODUCT_SLUGS = MODULES.map((m) => m.slug);

export type { ProductContent } from './_types';
