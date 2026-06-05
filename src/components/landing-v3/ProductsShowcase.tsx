import React, { useState } from 'react';
import {
  ArrowUpRight,
  AudioLines,
  Box,
  Building2,
  Cpu,
  FileText,
  Gamepad2,
  ImageIcon,
  MessageSquare,
  Sparkles,
  Terminal,
  Video,
  Workflow,
} from 'lucide-react';

type Tag = 'Generate' | 'Edit' | 'Build' | 'Write' | 'Automate' | 'Collaborate';

interface Product {
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tags: Tag[];
  /** Tailwind background classes used for the screenshot mock */
  screenshot: string;
}

const filters: ('All' | Tag)[] = ['All', 'Generate', 'Edit', 'Build', 'Write', 'Automate', 'Collaborate'];

const products: Product[] = [
  {
    name: 'XENO Gen',
    description: 'Image, video, voice and music generation with 20+ models.',
    icon: Sparkles,
    tags: ['Generate'],
    screenshot:
      'bg-[radial-gradient(ellipse_at_30%_40%,rgba(170,140,255,0.20),transparent_55%),linear-gradient(135deg,#1a1428_0%,#090909_75%)]',
  },
  {
    name: 'XENO Pixel',
    description: 'AI-native image editing, design, compositing and upscaling.',
    icon: ImageIcon,
    tags: ['Edit', 'Generate'],
    screenshot:
      'bg-[radial-gradient(ellipse_at_55%_55%,rgba(180,90,255,0.20),transparent_55%),linear-gradient(135deg,#1d1334_0%,#090909_70%)]',
  },
  {
    name: 'XENO Motion',
    description: 'Video editing, motion graphics and AI video pipelines.',
    icon: Video,
    tags: ['Edit', 'Generate'],
    screenshot:
      'bg-[radial-gradient(ellipse_at_70%_60%,rgba(255,150,210,0.16),transparent_55%),linear-gradient(135deg,#1c1422_0%,#090909_70%)]',
  },
  {
    name: 'XENO Sound',
    description: 'Audio editing, music production, voice and sound design.',
    icon: AudioLines,
    tags: ['Edit', 'Generate'],
    screenshot:
      'bg-[radial-gradient(ellipse_at_50%_60%,rgba(140,170,255,0.18),transparent_55%),linear-gradient(135deg,#11142a_0%,#090909_70%)]',
  },
  {
    name: 'XENO 3D',
    description: '3D modeling, rendering and asset creation.',
    icon: Box,
    tags: ['Build', 'Generate'],
    screenshot:
      'bg-[radial-gradient(ellipse_at_45%_50%,rgba(190,170,255,0.18),transparent_55%),linear-gradient(135deg,#16142a_0%,#090909_70%)]',
  },
  {
    name: 'XENO Architect',
    description: 'Architecture, CAD, BIM and interior design tools.',
    icon: Building2,
    tags: ['Build'],
    screenshot:
      'bg-[radial-gradient(ellipse_at_55%_55%,rgba(120,140,200,0.18),transparent_55%),linear-gradient(135deg,#0e1422_0%,#090909_70%)]',
  },
  {
    name: 'XENO Engine',
    description: 'Game engine, scenes, materials and real-time workflows.',
    icon: Gamepad2,
    tags: ['Build'],
    screenshot:
      'bg-[radial-gradient(ellipse_at_50%_55%,rgba(255,160,110,0.16),transparent_55%),linear-gradient(135deg,#1d1610_0%,#090909_70%)]',
  },
  {
    name: 'XENO Office',
    description: 'Docs, Sheets, Slides and Notes with AI built in.',
    icon: FileText,
    tags: ['Write', 'Collaborate'],
    screenshot:
      'bg-[radial-gradient(ellipse_at_50%_50%,rgba(220,200,160,0.16),transparent_55%),linear-gradient(135deg,#1a1814_0%,#090909_70%)]',
  },
  {
    name: 'XENO Workflow',
    description: 'Visual node-based automation pipelines.',
    icon: Workflow,
    tags: ['Automate', 'Build'],
    screenshot:
      'bg-[radial-gradient(ellipse_at_30%_60%,rgba(140,110,255,0.20),transparent_55%),linear-gradient(135deg,#15102a_0%,#090909_70%)]',
  },
  {
    name: 'XENO Comms',
    description: 'Human and agent communication for teams and communities.',
    icon: MessageSquare,
    tags: ['Collaborate'],
    screenshot:
      'bg-[radial-gradient(ellipse_at_40%_50%,rgba(140,200,255,0.16),transparent_55%),linear-gradient(135deg,#10182a_0%,#090909_70%)]',
  },
  {
    name: 'XENO Agent CLI',
    description: 'Code, automate and control your workspace.',
    icon: Terminal,
    tags: ['Automate', 'Write'],
    screenshot:
      'bg-[radial-gradient(ellipse_at_50%_60%,rgba(110,255,180,0.14),transparent_55%),linear-gradient(135deg,#0d1a18_0%,#090909_70%)]',
  },
  {
    name: 'XENO RT',
    description: 'Run models locally. Private, fast and powerful.',
    icon: Cpu,
    tags: ['Build', 'Automate'],
    screenshot:
      'bg-[radial-gradient(ellipse_at_55%_55%,rgba(180,140,255,0.20),transparent_55%),linear-gradient(135deg,#15112a_0%,#090909_70%)]',
  },
];

const ProductsShowcase: React.FC = () => {
  const [active, setActive] = useState<'All' | Tag>('All');

  const filtered =
    active === 'All' ? products : products.filter((p) => (p.tags as readonly string[]).includes(active));

  return (
    <section className="bg-[#060606] px-[1vw] py-[clamp(64px,9vh,120px)]">
      <div className="mx-auto w-full">
        {/* Title */}
        <h2 className="text-center text-[clamp(1.8rem,2.4vw,3rem)] font-semibold tracking-tight text-white">
          Everything you need to create. Connected.
        </h2>

        {/* Filter pills */}
        <div className="mt-[clamp(28px,4vh,52px)] flex flex-wrap justify-center gap-2">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setActive(f)}
              className={`rounded-full px-[clamp(14px,1.1vw,22px)] py-[clamp(7px,0.6vh,11px)] text-[clamp(11.5px,0.85vw,14px)] font-medium transition-colors ${
                active === f
                  ? 'bg-white text-black'
                  : 'border border-white/[0.10] bg-white/[0.02] text-[#b6afa5] hover:border-white/20 hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Grid */}
        <div className="mt-[clamp(36px,5vh,64px)] grid grid-cols-1 gap-[1vw] sm:grid-cols-2 lg:grid-cols-4">
          {filtered.map((product) => (
            <article
              key={product.name}
              className="group relative flex flex-col overflow-hidden rounded-[16px] border border-white/[0.08] bg-[#151515] p-[clamp(18px,1.4vw,28px)] transition-colors hover:border-white/[0.16]"
            >
              {/* Top: arrow + icon + title + description */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-3">
                  <ArrowUpRight className="h-4 w-4 text-[#69635b] transition-colors group-hover:text-[#d8d2ca]" />
                </div>
                <div className="flex-1" />
              </div>

              <div className="mt-1 flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[#9f6fff]/30 bg-[#1a1029]/40 text-[#bf85ff]">
                  <product.icon className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-[clamp(15px,1.05vw,18px)] font-semibold text-white">{product.name}</h3>
                </div>
              </div>

              <p className="mt-3 text-[clamp(12px,0.85vw,14px)] leading-[1.5] text-[#948d83]">
                {product.description}
              </p>

              {/* Screenshot mock */}
              <div className={`relative mt-[clamp(16px,1.6vw,28px)] aspect-[16/9] w-full overflow-hidden rounded-[10px] border border-white/[0.06] ${product.screenshot}`}>
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent_30%,transparent_70%,rgba(0,0,0,0.55))]" />
                {/* fake browser/app frame chrome */}
                <div className="absolute inset-x-3 top-2.5 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-white/15" />
                  <span className="h-1.5 w-1.5 rounded-full bg-white/15" />
                  <span className="h-1.5 w-1.5 rounded-full bg-white/15" />
                </div>
                {/* fake content row */}
                <div className="absolute inset-x-4 bottom-3 space-y-1.5">
                  <div className="h-1 w-2/5 rounded-full bg-white/15" />
                  <div className="h-1 w-1/4 rounded-full bg-white/8" />
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ProductsShowcase;
