import React from 'react';
import {
  Image, Video, Music, Box, Frame, Film, Brush, AudioWaveform,
  FileText, NotebookPen, Table2, Presentation,
  Plug, Bot, TerminalSquare, Sparkles, Cpu, Package, SquareTerminal, Workflow,
  LayoutGrid, Globe, MessagesSquare, Puzzle, Send,
  Boxes,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════════
 * A mark per product.
 *
 * The suite cards list their products as a two-column grid of icon + name, so
 * every product needs its own glyph — a repeated generic box would make the
 * grid read as a checklist rather than a set of distinct things.
 *
 * ── KEYED BY SLUG, NOT BY NAME ─────────────────────────────────────────────
 *
 * `slug` is the catalog's stable identifier — it is the R2 app id and the URL
 * segment, so it does not change. `name` is display copy and gets edited
 * ("XENO Agent CLI" → "XENO CLI") without anyone thinking about this file.
 *
 * ── FALLS BACK, NEVER THROWS ───────────────────────────────────────────────
 *
 * A product shipping tomorrow that nobody added here renders a generic mark and
 * a correct label. That is a mildly duller tile; throwing, or rendering a hole,
 * would take down the first screen a new account sees. `unmappedProducts()`
 * exists so a test can report the gap without the runtime caring about it.
 * ═══════════════════════════════════════════════════════════════════════════ */

const I = 'h-[13px] w-[13px]';

export const PRODUCT_ICON: Record<string, React.ReactNode> = {
  // Creative
  image:     <Image className={I} />,
  video:     <Video className={I} />,
  audio:     <Music className={I} />,
  '3d-gen':  <Box className={I} />,
  canvas:    <Frame className={I} />,
  motion:    <Film className={I} />,
  pixel:     <Brush className={I} />,
  sound:     <AudioWaveform className={I} />,

  // Office
  docs:      <FileText className={I} />,
  notes:     <NotebookPen className={I} />,
  sheets:    <Table2 className={I} />,
  slides:    <Presentation className={I} />,

  // Developer
  acp:       <Plug className={I} />,
  agent:     <Bot className={I} />,
  'agent-cli': <TerminalSquare className={I} />,
  anima:     <Sparkles className={I} />,
  rt:        <Cpu className={I} />,
  sdk:       <Package className={I} />,
  shell:     <SquareTerminal className={I} />,
  workflow:  <Workflow className={I} />,

  // Connect
  hub:       <LayoutGrid className={I} />,
  browser:   <Globe className={I} />,
  comms:     <MessagesSquare className={I} />,
  extension: <Puzzle className={I} />,
  post:      <Send className={I} />,
};

/** The mark for a product, or a generic one. */
export function productIcon(slug: string): React.ReactNode {
  return PRODUCT_ICON[slug] || <Boxes className={I} />;
}

/** Slugs with no dedicated mark — for a test to assert, not for the runtime. */
export function unmappedProducts(slugs: string[]): string[] {
  return slugs.filter((s) => !PRODUCT_ICON[s]).sort();
}
