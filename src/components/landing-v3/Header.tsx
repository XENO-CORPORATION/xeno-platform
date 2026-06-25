import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, Download, Menu, X } from 'lucide-react';

/* XENO wordmark with a soft light that follows the cursor, masked inside the glyphs */
function Wordmark() {
  const ref = useRef<HTMLSpanElement>(null);
  const onMove = (e: React.MouseEvent<HTMLSpanElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  return (
    <span ref={ref} onMouseMove={onMove} className="group/wm relative inline-block text-[17px] font-semibold tracking-tight">
      <span className="text-white">XENO AI</span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 ease-out group-hover/wm:opacity-100"
        style={{
          backgroundImage:
            'radial-gradient(circle 55px at var(--mx, 50%) var(--my, 50%), rgba(216,206,255,0.85), rgba(216,206,255,0) 70%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          WebkitTextFillColor: 'transparent',
        }}
      >
        XENO AI
      </span>
    </span>
  );
}

/* Animated cursor-click hint icon (cursor presses, spark lines burst out) */
function ClickHintIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <g className="hint-sparks">
        <path d="M7.2 2.2 8 5.1" />
        <path d="m5.1 8-2.9-.8" />
        <path d="M13.8 4.1 12 6" />
        <path d="m6 12-1.9 2" />
      </g>
      <g className="hint-cursor">
        <path d="M9 9l5 12 1.8-5.2L21 14Z" />
      </g>
    </svg>
  );
}

interface HeaderProps {
  onGetStarted: () => void;
  visible?: boolean;
}

/* ──────────────────────────────────────────────────────────────────────
 * Palette (xAI-style warm charcoal)
 * ────────────────────────────────────────────────────────────────────── */
const C = {
  card: '#151515',          // menu card base
  demo: '#0f0f0f',          // recessed showcase / demo pane
  title: '#d7d1c9',         // warm off-white item title
  titleHover: '#ffffff',
  desc: '#8d867e',          // warm taupe-grey description
  label: '#827b71',         // muted category label
  accent: '#b69dff',
  border: 'rgba(255,255,255,0.08)',
  divider: 'rgba(255,255,255,0.07)',
  hover: 'rgba(255,255,255,0.05)',
};

/* ──────────────────────────────────────────────────────────────────────
 * Nav data
 * ────────────────────────────────────────────────────────────────────── */

interface MenuItem {
  label: string;
  href: string;
  external?: boolean;
  /** Short one-liner shown under the title (xAI-style rich item) */
  subtitle?: string;
  /** Longer copy shown in the showcase pane */
  desc?: string;
  /** Tailwind bg classes for the showcase preview mock */
  tint?: string;
}
interface MenuSection {
  label: string;
  items: MenuItem[];
}
interface NavEntry {
  label: string;
  href: string;
  menu?: MenuSection[];
  /** Render the wide two-pane variant with a live preview pane */
  showcase?: boolean;
}

const radial = (rgb: string, base: string) =>
  `bg-[radial-gradient(ellipse_at_50%_42%,${rgb},transparent_55%),linear-gradient(160deg,${base}_0%,#090909_72%)]`;

const navItems: NavEntry[] = [
  {
    label: 'Products',
    href: '#products',
    showcase: true,
    menu: [
      {
        label: 'Generate',
        items: [
          { label: 'XENO Image', href: '#', subtitle: 'Text to image', desc: 'Generate images from a prompt with 20+ models.', tint: radial('rgba(170,140,255,0.30)', '#1a1428') },
          { label: 'XENO Video', href: '#', subtitle: 'Text to video', desc: 'Generate and edit video with AI pipelines.', tint: radial('rgba(255,150,210,0.24)', '#1c1422') },
          { label: 'XENO Audio', href: '#', subtitle: 'Voice & music', desc: 'Generate voice, music and sound effects.', tint: radial('rgba(140,170,255,0.26)', '#11142a') },
          { label: 'XENO 3D Gen', href: '#', subtitle: 'Text to 3D', desc: 'Generate 3D models & scenes from a prompt.', tint: radial('rgba(190,170,255,0.26)', '#16142a') },
        ],
      },
      {
        label: 'Create',
        items: [
          { label: 'XENO Pixel', href: '#', subtitle: 'Image editing', desc: 'AI-native image editing, design & upscaling.', tint: radial('rgba(186,96,255,0.30)', '#1d1334') },
          { label: 'XENO Photo', href: '#', subtitle: 'Photo catalog', desc: 'RAW import, organize, retouch & cloud sync.', tint: radial('rgba(120,200,255,0.24)', '#0e1a2a') },
          { label: 'XENO Motion', href: '#', subtitle: 'Video editing', desc: 'Video editing, motion graphics & AI pipelines.', tint: radial('rgba(255,150,210,0.24)', '#1c1422') },
          { label: 'XENO Sound', href: '#', subtitle: 'Audio editing', desc: 'Audio editing, music & voice production.', tint: radial('rgba(140,170,255,0.26)', '#11142a') },
        ],
      },
      {
        label: 'Design',
        items: [
          { label: 'XENO Canvas', href: '#', subtitle: 'UI & product design', desc: 'Multiplayer design, components & prototyping.', tint: radial('rgba(120,220,210,0.22)', '#0e1f1e') },
          { label: 'XENO Layout', href: '#', subtitle: 'Print & publishing', desc: 'Multi-page layouts for print & digital.', tint: radial('rgba(255,180,120,0.22)', '#1d160f') },
          { label: 'XENO 3D', href: '#', subtitle: '3D & rendering', desc: '3D modeling, rendering & asset creation.', tint: radial('rgba(190,170,255,0.26)', '#16142a') },
          { label: 'XENO Architect', href: '#', subtitle: 'CAD & BIM', desc: 'Architecture, CAD, BIM & interior design.', tint: radial('rgba(120,140,200,0.26)', '#0e1422') },
        ],
      },
      {
        label: 'Office',
        items: [
          { label: 'XENO Docs', href: '#', subtitle: 'Documents', desc: 'AI-native document editing.', tint: radial('rgba(220,200,160,0.24)', '#1a1814') },
          { label: 'XENO Sheets', href: '#', subtitle: 'Spreadsheets', desc: 'Spreadsheets with AI built in.', tint: radial('rgba(150,220,160,0.22)', '#101a12') },
          { label: 'XENO Slides', href: '#', subtitle: 'Presentations', desc: 'Presentations with AI built in.', tint: radial('rgba(255,170,120,0.22)', '#1d160f') },
          { label: 'XENO PDF', href: '#', subtitle: 'PDF tools', desc: 'Edit, convert, sign & chat with PDFs.', tint: radial('rgba(255,120,120,0.22)', '#1d1010') },
        ],
      },
      {
        label: 'Library',
        items: [
          { label: 'XENO Stock', href: '#', subtitle: 'Asset library', desc: 'Royalty-free & AI-generated media.', tint: radial('rgba(150,200,255,0.22)', '#0e162a') },
          { label: 'XENO Fonts', href: '#', subtitle: 'Typography', desc: 'Browse & sync fonts for any project.', tint: radial('rgba(220,200,160,0.22)', '#1a1814') },
          { label: 'XENO Assets', href: '#', subtitle: 'Asset manager', desc: 'Central DAM with versions & review.', tint: radial('rgba(180,160,255,0.24)', '#14122a') },
          { label: 'XENO Notes', href: '#', subtitle: 'Knowledge base', desc: 'Notes & knowledge with AI.', tint: radial('rgba(170,150,255,0.26)', '#15122a') },
        ],
      },
      {
        label: 'Connect',
        items: [
          { label: 'XENO Comms', href: '#', subtitle: 'Messaging', desc: 'Human & agent communication for teams.', tint: radial('rgba(140,200,255,0.24)', '#10182a') },
          { label: 'XENO Post', href: '#', subtitle: 'Social media', desc: '25+ platform social command center.', tint: radial('rgba(255,140,190,0.24)', '#1d1019') },
          { label: 'XENO Browser', href: '#', subtitle: 'AI browser', desc: 'Agent-native browser that works the web for you.', tint: radial('rgba(120,205,255,0.26)', '#0b1622') },
          { label: 'XENO Extension', href: '#', subtitle: 'For Chrome & Edge', desc: 'Bring the XENO agent to other browsers.', tint: radial('rgba(150,140,255,0.28)', '#13122a') },
        ],
      },
      {
        label: 'Build',
        items: [
          { label: 'XENO Engine', href: '#', subtitle: 'Game engine', desc: 'ECS game engine, physics & multiplayer.', tint: radial('rgba(255,160,110,0.24)', '#1d1610') },
          { label: 'XENO Workflow', href: '#', subtitle: 'Automation', desc: 'Visual node-based automation pipelines.', tint: radial('rgba(140,110,255,0.30)', '#15102a') },
          { label: 'XENO Use', href: '#', subtitle: 'Device actions', desc: "The agent's hands across every device.", tint: radial('rgba(120,220,150,0.22)', '#0d1c14') },
          { label: 'XENO Apps', href: '#', subtitle: 'App builder', desc: 'No-code custom apps & internal tools.', tint: radial('rgba(255,200,120,0.22)', '#1d1810') },
        ],
      },
      {
        label: 'Develop',
        items: [
          { label: 'XENO Agent CLI', href: '#', subtitle: 'Terminal agent', desc: 'Code, automate & control your workspace.', tint: radial('rgba(130,230,160,0.22)', '#0d1c14') },
          { label: 'XENO SDK', href: '#', subtitle: 'Agent SDK', desc: 'Embed XENO agents into any app.', tint: radial('rgba(170,150,255,0.26)', '#15122a') },
          { label: 'XENO RT', href: '#', subtitle: 'Local runtime', desc: 'Run models locally — private & fast.', tint: radial('rgba(140,180,255,0.24)', '#0e162a') },
          { label: 'XENO Shell', href: '#', subtitle: 'Desktop OS', desc: 'The XENO desktop environment for every app.', tint: radial('rgba(200,200,210,0.20)', '#15161a') },
          { label: 'XENO Swarm', href: '#', subtitle: 'Agent swarms', desc: 'Always-on Minds that coordinate as a swarm.', tint: radial('rgba(180,140,255,0.28)', '#15102a') },
        ],
      },
    ],
  },
  {
    label: 'Marketplace',
    href: '/marketplace',
    menu: [
      {
        label: 'Browse',
        items: [
          { label: 'Apps', href: '/marketplace?kind=app-native', subtitle: 'Native & sandboxed apps' },
          { label: 'Panels', href: '/marketplace?kind=panel', subtitle: 'Composable UI panels' },
          { label: 'Plugins & MCP', href: '/marketplace?kind=plugin', subtitle: 'Extend agents & apps' },
          { label: 'Models', href: '/marketplace?kind=model', subtitle: 'GGUF & ONNX models' },
          { label: 'Minds & Swarms', href: '/marketplace?kind=mind', subtitle: 'Buy, subscribe or rent agents' },
        ],
      },
      {
        label: 'Create',
        items: [
          { label: 'Become a creator', href: '/marketplace?tab=sell', subtitle: 'Publish & earn credits' },
          { label: 'Publish a panel', href: '/marketplace?tab=sell', subtitle: 'Ship with the Panel SDK' },
          { label: 'Sell a Mind', href: '/marketplace?tab=sell', subtitle: 'Monetize your agents' },
          { label: 'Developer docs', href: '/learn', subtitle: 'Build for the platform' },
        ],
      },
    ],
  },
  {
    label: 'Solutions',
    href: '#solutions',
    menu: [
      {
        label: 'By industry',
        items: [
          { label: 'Marketing & Advertising', href: '#', subtitle: 'Campaigns that convert' },
          { label: 'Media & Entertainment', href: '#', subtitle: 'Film, video & content' },
          { label: 'Gaming', href: '#', subtitle: 'Build worlds, faster' },
          { label: 'Architecture & Design', href: '#', subtitle: 'Concept to construction' },
          { label: 'E-commerce & Retail', href: '#', subtitle: 'Product visuals that sell' },
          { label: 'Agencies & Studios', href: '#', subtitle: 'Deliver more for clients' },
          { label: 'Education', href: '#', subtitle: 'Teach & learn with AI' },
        ],
      },
      {
        label: 'By team',
        items: [
          { label: 'Designers', href: '#', subtitle: 'Design, prototype, ship' },
          { label: 'Marketers', href: '#', subtitle: 'Content that performs' },
          { label: 'Content Creators', href: '#', subtitle: 'Create more, everywhere' },
          { label: 'Video & Film', href: '#', subtitle: 'Edit & generate video' },
          { label: 'Developers', href: '#', subtitle: 'Build with the SDK & CLI' },
          { label: 'Enterprise & Teams', href: '#', subtitle: 'Private, secure, at scale' },
        ],
      },
    ],
  },
  { label: 'Docs', href: '/learn' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Blog', href: '/blog' },
];

/* ──────────────────────────────────────────────────────────────────────
 * Mega-menu row — rich (title + subtitle) or compact (title only)
 * ────────────────────────────────────────────────────────────────────── */

/* Renders a product name with a muted "XENO" lead-in (keeps the brand, kills the repetition) */
function ProductLabel({ label }: { label: string }) {
  if (label.startsWith('XENO ')) {
    return (
      <span>
        <span className="font-normal" style={{ color: C.label }}>XENO&nbsp;</span>
        {label.slice(5)}
      </span>
    );
  }
  return <span>{label}</span>;
}

function MenuRow({ item, onHover, onPreview }: { item: MenuItem; onHover: (el: HTMLElement, item: MenuItem) => void; onPreview?: (item: MenuItem) => void }) {
  const rich = Boolean(item.subtitle);
  const handleEnter = (e: React.MouseEvent<HTMLElement>) => onHover(e.currentTarget, item);
  const handleContext = onPreview ? (e: React.MouseEvent) => { e.preventDefault(); onPreview(item); } : undefined;

  const cls = rich
    ? 'group/row relative z-[1] block whitespace-nowrap rounded-lg px-2.5 py-[7px] transition-colors'
    : 'group/row relative z-[1] flex h-[34px] items-center justify-between gap-2 whitespace-nowrap rounded-md px-2.5 transition-colors';

  const inner = rich ? (
    <>
      <span className="flex items-center gap-1 text-[13.5px] font-medium leading-tight transition-colors" style={{ color: C.title }}>
        <ProductLabel label={item.label} />
        <ArrowUpRight className="h-3 w-3 -translate-x-1 opacity-0 transition-all duration-150 group-hover/row:translate-x-0 group-hover/row:opacity-100" style={{ color: C.desc }} />
      </span>
      <span className="mt-0.5 block text-[11px] leading-snug" style={{ color: C.desc }}>{item.subtitle}</span>
    </>
  ) : (
    <>
      <span className="text-[13.5px] font-medium leading-none transition-colors" style={{ color: C.title }}><ProductLabel label={item.label} /></span>
      <ArrowUpRight className="h-3.5 w-3.5 -translate-x-1 opacity-0 transition-all duration-150 group-hover/row:translate-x-0 group-hover/row:opacity-100" style={{ color: C.desc }} />
    </>
  );

  if (item.href.startsWith('/')) {
    return (
      <Link to={item.href} className={cls} onMouseEnter={handleEnter} onContextMenu={handleContext}>
        {inner}
      </Link>
    );
  }
  return (
    <a
      href={item.href}
      className={cls}
      onMouseEnter={handleEnter}
      onContextMenu={handleContext}
      onClick={item.href === '#' ? (e) => e.preventDefault() : undefined}
      target={item.external ? '_blank' : undefined}
      rel={item.external ? 'noopener noreferrer' : undefined}
    >
      {inner}
    </a>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Showcase preview pane (right side of the Products mega-menu)
 * ────────────────────────────────────────────────────────────────────── */

function ShowcasePane({ item }: { item: MenuItem }) {
  return (
    // Full-width demo panel — expands in on right-click; only the tint inside morphs after that
    <div className="w-full overflow-hidden px-3 pb-3 pt-0" style={{ backgroundColor: C.card, animation: 'xenoExpandDown 300ms cubic-bezier(0.2,0.7,0.2,1)' }}>
      <div className="relative h-[460px] w-full overflow-hidden rounded-[10px]" style={{ border: `1px solid ${C.border}` }}>
        <div key={item.label} className={`absolute inset-0 ${item.tint ?? ''}`} style={{ animation: 'xenoFadeContent 260ms ease' }} />
        <div className="absolute inset-x-4 top-3.5 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-[2px] bg-white/20" />
          <span className="h-1.5 w-1.5 rounded-[2px] bg-white/15" />
          <span className="h-1.5 w-1.5 rounded-[2px] bg-white/10" />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_55%,rgba(0,0,0,0.4))]" />
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * A nav item with a dropdown mega-menu
 * ────────────────────────────────────────────────────────────────────── */

function NavDropdown({ entry, onOpen, onClose }: { entry: NavEntry; onOpen: () => void; onClose: () => void }) {
  const [hl, setHl] = useState({ top: 0, left: 0, width: 0, height: 0, visible: false });
  // The demo panel is revealed only on right-click of a product (null = hidden)
  const [preview, setPreview] = useState<MenuItem | null>(null);

  const onHover = (el: HTMLElement, item: MenuItem) => {
    setHl({ top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight, visible: true });
  };
  const hideHl = () => setHl((h) => ({ ...h, visible: false }));
  // Right-click toggles the demo: same product again collapses it, a different one switches
  const togglePreview = (item: MenuItem) => setPreview((prev) => (prev && prev.label === item.label ? null : item));

  const list = (
    <div
      onMouseLeave={hideHl}
      className="relative flex gap-1 px-2.5 pb-2.5 pt-3"
      style={{ backgroundColor: C.card }}
    >
      {/* Sliding highlight that follows the hovered row */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute rounded-lg"
        style={{
          top: hl.top,
          left: hl.left,
          width: hl.width,
          height: hl.height,
          backgroundColor: C.hover,
          opacity: hl.visible ? 1 : 0,
          transition:
            'top 170ms cubic-bezier(0.2,0.7,0.2,1), left 170ms cubic-bezier(0.2,0.7,0.2,1), width 170ms cubic-bezier(0.2,0.7,0.2,1), height 170ms cubic-bezier(0.2,0.7,0.2,1), opacity 140ms ease',
        }}
      />
      {entry.menu!.map((section) => (
        <div key={section.label} className={`group/cat ${entry.showcase ? 'w-[150px]' : 'w-[190px]'}`}>
          <div className="pl-3.5 pr-2.5 pt-0">
            <div className="inline-flex flex-col">
              <span className="text-[10px] font-semibold uppercase leading-none tracking-[0.2em] text-[#827b71] transition-colors duration-300 ease-out group-hover/cat:text-[#a89f95]">
                {section.label}
              </span>
              <div className="relative mb-2 mt-1.5 h-px w-full">
                <span className="absolute left-0 top-0 h-px w-8 transition-transform duration-300 ease-out group-hover/cat:translate-x-1" style={{ backgroundColor: C.border }} />
              </div>
            </div>
          </div>
          {section.items.map((item) => (
            <MenuRow key={item.label} item={item} onHover={onHover} onPreview={entry.showcase ? togglePreview : undefined} />
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <li className="group/nav relative" onMouseEnter={onOpen} onMouseLeave={() => { onClose(); setPreview(null); }}>
      <button
        type="button"
        className="flex items-center gap-1 px-1 py-1.5 text-[13px] font-normal text-[#b6afa5] transition-colors hover:text-white group-hover/nav:text-white"
      >
        {entry.label}
        <ChevronDown className="h-3 w-3 text-[#8a847b] transition-transform duration-200 group-hover/nav:rotate-180" />
      </button>

      {/* Panel wrapper — fixed & viewport-centered; top overlaps the trigger and pt-2 bridges down to the card */}
      <div className="invisible fixed left-1/2 top-[34px] z-50 -translate-x-1/2 -translate-y-1 pt-2 opacity-0 transition-[opacity,transform] duration-200 ease-out group-hover/nav:visible group-hover/nav:translate-y-0 group-hover/nav:opacity-100">
        <div
          className="flex flex-col overflow-hidden rounded-[14px] shadow-[0_24px_70px_-16px_rgba(0,0,0,0.85)]"
          style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}
        >
          {list}
          {/* Featured: XENO Hub — the umbrella app that nests every tool (under the categories) */}
          {entry.showcase && (
            <div className="px-2.5 pb-2.5 pt-0.5">
              <Link
                to="/download"
                className="group/hub flex items-center gap-3 rounded-[10px] border px-3.5 py-2.5 transition-colors hover:brightness-125"
                style={{ borderColor: C.border, backgroundColor: 'rgba(167,96,255,0.06)' }}
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px]" style={{ backgroundColor: 'rgba(167,96,255,0.12)' }}>
                  <img src="/xeno-logo.svg" alt="" className="h-5 w-5 invert" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: '#f2efe9' }}>
                    XENO Hub
                    <span className="rounded-[4px] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: C.accent, backgroundColor: 'rgba(167,96,255,0.14)' }}>
                      All-in-one
                    </span>
                  </div>
                  <div className="text-[11.5px]" style={{ color: C.desc }}>The desktop app that brings every XENO tool together</div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-[6px] border px-3 py-1.5 text-[11.5px] font-medium" style={{ color: '#f2efe9', borderColor: C.border }}>
                  Download
                  <Download className="h-3.5 w-3.5" />
                </span>
              </Link>
            </div>
          )}
          {entry.showcase && preview && <ShowcasePane item={preview} />}
        </div>

        {/* Hint — sits outside the card, below it, with a margin */}
        {entry.showcase && !preview && (
          <div className="mt-3 flex items-center justify-center gap-2 text-[11.5px] font-medium opacity-60" style={{ color: C.label }}>
            <ClickHintIcon className="h-4 w-4 translate-x-[3px] -translate-y-[2px]" />
            Right-click any product to preview its demo
          </div>
        )}
      </div>
    </li>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Header
 * ────────────────────────────────────────────────────────────────────── */

const Header: React.FC<HeaderProps> = ({ onGetStarted, visible = true }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [scrimOn, setScrimOn] = useState(false);
  const closeT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openScrim = () => { if (closeT.current) clearTimeout(closeT.current); setScrimOn(true); };
  const closeScrim = (delay = 150) => {
    if (closeT.current) clearTimeout(closeT.current);
    closeT.current = setTimeout(() => setScrimOn(false), delay);
  };

  return (
    <>
      {/* Scrim — dims/blurs the page behind an open mega-menu (header stays crisp above it) */}
      <div
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/80 transition-opacity duration-200 ease-out ${
          scrimOn ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <header
        onMouseLeave={() => closeScrim(150)}
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
          visible ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0 pointer-events-none'
        }`}
      >
        <div className="relative flex h-[56px] w-full items-center justify-between px-[1.4vw]">
          {/* ── Left: Logo + breadcrumb ─────────────────────────────── */}
          <div className="flex items-center gap-8">
            <Link to="/v3" className="group flex items-center gap-2.5" aria-label="XENO AI home">
              <img
                src="/xeno-logo.svg"
                alt=""
                className="h-6 w-6 invert drop-shadow-[0_0_10px_rgba(255,255,255,0.18)] transition-transform duration-300 group-hover:scale-105"
              />
              <Wordmark />
            </Link>

            <nav className="hidden items-center gap-2 text-[9.5px] font-semibold tracking-[0.22em] md:flex">
              <a href="#explore" className="text-[#756f66] transition-colors hover:text-[#b6afa5]">EXPLORE</a>
              <span className="text-[#46423b]">/</span>
              <a href="#create" className="text-[#756f66] transition-colors hover:text-[#b6afa5]">CREATE</a>
              <span className="text-[#46423b]">/</span>
              <a href="#innovate" className="text-[#a760ff] transition-colors hover:text-[#bf85ff]">INNOVATE</a>
            </nav>
          </div>

          {/* ── Center: main nav (dropdown-capable) — absolutely viewport-centered ── */}
          <nav className="absolute left-1/2 hidden -translate-x-1/2 lg:block">
            <ul className="flex items-center gap-2">
              {navItems.map((item) => {
                if (item.menu) return <NavDropdown key={item.label} entry={item} onOpen={openScrim} onClose={() => closeScrim(900)} />;
                const cls = 'px-1 py-1.5 text-[13px] font-normal text-[#b6afa5] transition-colors hover:text-white';
                return (
                  <li key={item.label}>
                    {item.href.startsWith('/') ? (
                      <Link to={item.href} className={cls}>{item.label}</Link>
                    ) : (
                      <a href={item.href} className={cls}>{item.label}</a>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* ── Right: Sign in + Download ───────────────────────────── */}
          <div className="hidden items-center gap-5 lg:flex">
            <button
              type="button"
              onClick={onGetStarted}
              className="text-[13px] font-normal text-[#b6afa5] transition-colors hover:text-white"
            >
              Sign in
            </button>
            <Link
              to="/download"
              className="group inline-flex h-[36px] items-center gap-2.5 rounded-[5px] border border-white/20 bg-transparent px-5 text-[12px] font-medium text-white transition-colors hover:border-white/45 hover:bg-white/[0.04]"
            >
              Download
              <Download className="h-3.5 w-3.5 stroke-[1.6]" />
            </Link>
          </div>

          {/* ── Mobile menu trigger ─────────────────────────────────── */}
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen((open) => !open)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-[6px] border border-white/10 bg-[#060606]/25 text-[#c2bbb2] backdrop-blur-xl lg:hidden"
            aria-label="Toggle navigation"
          >
            {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </header>

      {/* ── Mobile menu drawer ─────────────────────────────────────── */}
      <div
        className={`fixed inset-0 z-40 bg-[#060606]/95 backdrop-blur-2xl transition-all duration-300 lg:hidden ${
          isMobileMenuOpen ? 'visible opacity-100' : 'invisible opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex h-full flex-col px-7 pb-8 pt-24">
          <nav className="flex flex-1 flex-col">
            {navItems.map((item) => {
              const className = 'flex items-center justify-between border-b border-white/[0.07] py-5 text-xl font-medium text-[#b6afa5]';
              return item.href.startsWith('/') ? (
                <Link key={item.label} to={item.href} onClick={() => setIsMobileMenuOpen(false)} className={className}>{item.label}</Link>
              ) : (
                <a key={item.label} href={item.href} onClick={() => setIsMobileMenuOpen(false)} className={className}>{item.label}</a>
              );
            })}
          </nav>

          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => { setIsMobileMenuOpen(false); onGetStarted(); }}
              className="h-12 rounded-[6px] border border-white/10 text-sm font-medium text-[#b6afa5]"
            >
              Sign in
            </button>
            <Link
              to="/download"
              onClick={() => setIsMobileMenuOpen(false)}
              className="flex h-12 items-center justify-center gap-2 rounded-[6px] border border-white/20 text-sm font-medium text-white"
            >
              Download <Download className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </>
  );
};

export default Header;
