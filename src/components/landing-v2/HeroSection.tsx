import React from 'react';
import { ArrowUpRight, CheckCircle2, Cloud, Play, Search, Settings, ShieldCheck, Users, Zap } from 'lucide-react';

function Callout({ id, label, side, panelClass, offset = '-3svh', angledWrap = false }: { id: string; label: string; side: 'left' | 'right'; panelClass: string; offset?: string; angledWrap?: boolean }) {
  // When angledWrap is true, the rotation lives on the wrap div (so it shares the panel's angle).
  // Inner callout then renders flat on top of the rotated wrap (no double-rotation).
  return (
    <div
      className={`hero-callout-wrap pointer-events-none absolute left-0 w-full ${angledWrap ? panelClass : ''}`}
      style={{ top: offset, ...(angledWrap ? { transformStyle: 'preserve-3d' as const } : {}) }}
    >
      <div className={`hero-callout hero-callout-${side} ${angledWrap ? '' : panelClass} grid w-max ${side === 'right' ? 'ml-auto' : ''}`}>
        <div className="hero-callout-index">{id}</div>
        <div className="hero-callout-rule" />
        <div className="hero-callout-label">{label}</div>
      </div>
    </div>
  );
}

const metrics = [
  { icon: ShieldCheck, title: 'Enterprise Grade', sub: 'Security & Privacy' },
  { icon: CheckCircle2, title: '99.99%', sub: 'Uptime SLA' },
  { icon: Users, title: '10K+', sub: 'Active Teams' },
  { icon: Zap, title: '2M+', sub: 'AI Tasks Executed' },
  { icon: Cloud, title: 'Local + Cloud', sub: 'Freedom of Choice' },
];

function WorkflowPanel() {
  const nodes = [
    { label: 'Trigger', x: 8, y: 18, active: false },
    { label: 'Clear Intent', x: 26, y: 48, active: false },
    { label: 'Search Web', x: 43, y: 28, active: true },
    { label: 'Generate Draft', x: 62, y: 35, active: true },
    { label: 'Generate Image', x: 77, y: 39, active: false },
    { label: 'Deploy Production', x: 90, y: 61, active: false },
  ];

  return (
    <div className="hero-float absolute left-[14%] top-[18%] hidden h-[18%] w-[24%] lg:block" style={{ ['--float-duration' as any]: '9s', ['--float-delay' as any]: '0s' }}>
    <div className="hero-glass hero-panel-left-soft absolute inset-0">
      <svg className="absolute inset-0 h-full w-full opacity-45" viewBox="0 0 560 220" fill="none" aria-hidden="true">
        <path d="M74 62H150V116H224V86H328V103H414V118H498" stroke="rgba(180,159,255,0.24)" strokeWidth="1.2" />
        <path d="M74 62V140H150" stroke="rgba(180,159,255,0.16)" strokeWidth="1.2" />
        <path d="M150 116V162H224" stroke="rgba(180,159,255,0.14)" strokeWidth="1.2" />
      </svg>
      {nodes.map((node) => (
        <div
          key={node.label}
          className={`absolute rounded-[4px] border px-1.5 py-1 text-[8px] leading-tight shadow-[0_12px_32px_rgba(0,0,0,0.34)] ${
            node.active
              ? 'border-[#8e62ff]/28 bg-[#2b1f58]/70 text-[#d8caff]'
              : 'border-white/10 bg-[#0b0b11]/80 text-white/40'
          }`}
          style={{ left: `${node.x}%`, top: `${node.y}%`, transform: 'translate(-50%, -50%)' }}
        >
          {node.label}
        </div>
      ))}
    </div>
    <Callout id="01" label="Workflow" side="left" panelClass="hero-panel-left-soft" offset="-5svh" angledWrap />
    </div>
  );
}

function TerminalPanel() {
  return (
    <div className="hero-float absolute left-[28%] top-[43%] hidden h-[12%] w-[15.5%] lg:block" style={{ ['--float-duration' as any]: '7.5s', ['--float-delay' as any]: '1.5s' }}>
    <div className="hero-glass hero-panel-left-soft absolute inset-0">
      <div className="relative z-[1] flex h-6 items-center justify-between border-b border-white/[0.055] px-3.5">
        <span className="font-mono text-[10px] text-white/60">xeno-agent</span>
        <span className="text-[10px] text-white/22">...</span>
      </div>
      <div className="relative z-[1] space-y-2 px-3.5 py-3 font-mono text-[9px] leading-tight text-white/45">
        <p>xenoAgent:~$ xeno run</p>
        <p className="pt-1.5">Initializing XENO Agent...</p>
        <p>Connecting to workspace</p>
        <p>Loading tools</p>
        <p>Agent ready.</p>
        <p className="pt-2">xenoAgent:~$ _</p>
      </div>
    </div>
    <Callout id="02" label="Agent CLI" side="left" panelClass="hero-panel-left-soft" angledWrap />
    </div>
  );
}

function CommsPanel() {
  return (
    <div className="hero-float absolute right-[26%] top-[13%] hidden h-[16%] w-[11%] xl:block" style={{ ['--float-duration' as any]: '8.5s', ['--float-delay' as any]: '0.8s' }}>
    <div className="hero-glass hero-panel-right-small absolute inset-0">
      <div className="relative z-[1] border-b border-white/[0.055] px-3 py-2 font-mono text-[9px] text-white/50"># product-strategy</div>
      <div className="relative z-[1] space-y-2 px-3 py-2.5">
        {['Alex', 'Sam', 'Mira'].map((name, index) => (
          <div key={name} className="flex gap-2">
            <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-white/10 bg-white/[0.08]" />
            <div className="min-w-0 flex-1">
              <div className="text-[9px] text-white/55">{name}</div>
              <div className="mt-1 h-1.5 rounded-full bg-white/[0.14]" style={{ width: `${56 + index * 12}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="relative z-[1] mx-3 mt-1 h-5 rounded-[4px] border border-white/[0.055] bg-black/16" />
    </div>
    <Callout id="03" label="Comms" side="right" panelClass="hero-panel-right-small" angledWrap />
    </div>
  );
}

function MediaPanel() {
  return (
    <div className="hero-float absolute right-[14%] top-[33%] hidden h-[15%] w-[14.1%] xl:block" style={{ ['--float-duration' as any]: '10s', ['--float-delay' as any]: '2.2s' }}>
    <div className="hero-glass hero-panel-right absolute inset-0 overflow-hidden">
      <div className="absolute left-2 top-3 grid gap-2">
        {[Search, Settings, Play].map((Icon, index) => (
          <span key={index} className="grid h-5 w-5 place-items-center rounded-[4px] border border-white/[0.06] bg-white/[0.035]">
            <Icon className="h-3 w-3 text-white/40" />
          </span>
        ))}
      </div>
      <div className="absolute inset-x-12 top-5 h-[61%] rounded-[8px] bg-[radial-gradient(circle_at_45%_45%,rgba(178,139,255,0.20),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.13),rgba(255,255,255,0.01)_48%,rgba(141,98,255,0.15))] shadow-[0_0_48px_rgba(158,111,255,0.08)]">
        <div className="absolute left-[16%] top-[42%] h-[26%] w-[66%] skew-x-[-18deg] rounded-[10px] border border-white/10 bg-black/70 shadow-[0_0_28px_rgba(180,159,255,0.12)]" />
      </div>
      <div className="absolute bottom-3 left-4 right-4 flex items-center gap-3">
        <Play className="h-3 w-3 text-white/35" />
        <span className="h-px flex-1 bg-[#8e62ff]/50" />
        <span className="h-1.5 w-1.5 rounded-full bg-[#8e62ff]" />
        <span className="h-px w-14 bg-white/10" />
      </div>
    </div>
    <Callout id="04" label="3D / Media Studio" side="right" panelClass="hero-panel-right" angledWrap />
    </div>
  );
}

function RuntimePanel() {
  return (
    <div className="hero-float absolute right-[27%] top-[55%] hidden h-[10.5%] w-[12.9%] xl:block" style={{ ['--float-duration' as any]: '7s', ['--float-delay' as any]: '0.4s' }}>
    <div className="hero-glass hero-panel-right-soft absolute inset-0">
      <div className="relative z-[1] px-4 py-3">
        <div className="text-[11px] font-semibold text-white/68">Runtime</div>
        <div className="mt-3 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[#a069ff]" />
          <span className="text-[9px] text-white/48">Running locally</span>
        </div>
        <div className="mt-4 h-2 w-[58%] rounded-full bg-white/[0.07]" />
      </div>
      <div className="absolute bottom-0 right-3 z-[1] h-[68%] w-[35%] rounded-t-[8px] border border-[#9f8aff]/16 bg-[linear-gradient(120deg,rgba(255,255,255,0.08),rgba(138,88,255,0.09)_50%,rgba(0,0,0,0.18))]" />
    </div>
    <Callout id="05" label="Local Runtime" side="right" panelClass="hero-panel-right-soft" angledWrap />
    </div>
  );
}

function OfficePanel() {
  return (
    <div className="hero-float absolute right-[15%] top-[72%] hidden h-[13%] w-[12.5%] xl:block" style={{ ['--float-duration' as any]: '8s', ['--float-delay' as any]: '1.8s' }}>
    <div className="hero-glass hero-panel-right-low absolute inset-0">
      <div className="relative z-[1] space-y-1.5 px-4 py-3">
        {['Docs', 'Plans', 'Reports', 'Settings'].map((item) => (
          <div key={item} className="flex items-center gap-2 text-[10px] text-white/52">
            <span className="h-3 w-3 rounded-full border border-white/10" />
            {item}
          </div>
        ))}
      </div>
      <div className="absolute bottom-0 right-0 z-[1] h-[78%] w-[40%] rounded-tl-[64px] bg-[linear-gradient(135deg,rgba(21,14,32,0.28),rgba(255, 255, 255,0.62))] opacity-56" />
    </div>
    <Callout id="06" label="Office" side="right" panelClass="hero-panel-right-low" angledWrap />
    </div>
  );
}

const liquidDisplacementMap =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200' preserveAspectRatio='none'>" +
      "<defs>" +
      "<linearGradient id='x' x1='0' y1='0' x2='1' y2='0'>" +
      "<stop offset='0' stop-color='#ff0000'/>" +
      "<stop offset='1' stop-color='#000000'/>" +
      "</linearGradient>" +
      "<linearGradient id='y' x1='0' y1='0' x2='0' y2='1'>" +
      "<stop offset='0' stop-color='#00ff00'/>" +
      "<stop offset='1' stop-color='#000000'/>" +
      "</linearGradient>" +
      "</defs>" +
      "<rect width='200' height='200' fill='url(#x)'/>" +
      "<rect width='200' height='200' fill='url(#y)' style='mix-blend-mode:screen'/>" +
      "</svg>",
  );

const HeroSection: React.FC = () => {
  return (
    <section className="relative isolate min-h-[100svh] overflow-hidden bg-[#020203] text-white">
      <svg aria-hidden="true" className="pointer-events-none absolute h-0 w-0">
        <defs>
          <filter id="hero-liquid" x="0%" y="0%" width="100%" height="100%">
            <feImage href={liquidDisplacementMap} x="0" y="0" width="100%" height="100%" result="map" preserveAspectRatio="none" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale="28" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <filter id="hero-liquid-strong" x="0%" y="0%" width="100%" height="100%">
            <feImage href={liquidDisplacementMap} x="0" y="0" width="100%" height="100%" result="map" preserveAspectRatio="none" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale="58" xChannelSelector="R" yChannelSelector="G" result="disp" />
            <feColorMatrix in="disp" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="rgba" />
          </filter>
        </defs>
      </svg>
      <img
        src="/landing-v2/xeno-hero-portal-balanced.png"
        alt=""
        className="absolute inset-0 z-0 h-full w-full scale-[1.005] -translate-x-[3.9vw] object-cover object-center opacity-95"
      />
      <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_52%_43%,rgba(142,98,255,0.08),transparent_34%),linear-gradient(90deg,rgba(2,2,3,0.38),transparent_29%,transparent_66%,rgba(2,2,3,0.42)),linear-gradient(180deg,rgba(0,0,0,0.15),transparent_60%,rgba(0,0,0,0.58))]" />
      <div className="absolute inset-0 z-0 opacity-[0.18] [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:25vw_25vh]" />
      <div
        className="pointer-events-none absolute inset-0 z-[8]"
        style={{
          background: [
            'radial-gradient(ellipse at 53% 48%, transparent 0%, transparent 34%, rgba(0,0,0,0.22) 58%, rgba(0,0,0,0.78) 100%)',
            'linear-gradient(90deg, rgba(0,0,0,0.96) 0%, rgba(0,0,0,0.70) 8%, rgba(0,0,0,0.18) 25%, transparent 43%, transparent 57%, rgba(0,0,0,0.22) 74%, rgba(0,0,0,0.78) 91%, rgba(0,0,0,0.98) 100%)',
            'linear-gradient(180deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.30) 16%, transparent 38%, transparent 58%, rgba(0,0,0,0.48) 82%, rgba(0,0,0,0.96) 100%)',
          ].join(', '),
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[9] h-[32vh] bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.46)_42%,#020203_100%)]" />

      <WorkflowPanel />
      <TerminalPanel />
      <CommsPanel />
      <MediaPanel />
      <RuntimePanel />
      <OfficePanel />

<div className="pointer-events-none relative z-20 flex min-h-[100svh] flex-col justify-end px-6 pb-6 pt-[78px] sm:px-10 lg:px-[4.7vw]">
        <div className="pointer-events-auto w-full max-w-[900px] pb-8 sm:pb-9 lg:pb-10">
          <div className="mb-5 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.08em] text-[#e8e3dc] drop-shadow-[0_0_14px_rgba(255, 255, 255,0.4)]">
            <span className="h-2 w-2 rounded-full bg-white" />
            The complete AI operating environment
          </div>
          <h1 className="max-w-[900px] text-[clamp(3.7rem,4.3vw,4.85rem)] font-extralight leading-[1.02] tracking-normal text-white drop-shadow-[0_0_18px_rgba(255,255,255,0.12)]">
            <span className="block">Where humans</span>
            <span className="block sm:whitespace-nowrap">imagine and <span className="font-light text-[#e8e3dc] drop-shadow-[0_0_20px_rgba(255, 255, 255,0.45)]">AI</span> builds.</span>
          </h1>
          <p className="mt-5 max-w-[540px] text-[15px] font-medium leading-7 text-white/80">
            All the tools. All the models. All connected by agents.
            <br />
            One workspace to create, automate, and scale anything.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-5">
            <a
              href="/auth"
              className="group inline-flex h-[44px] items-center gap-3 rounded-[10px] bg-white px-6 text-[14px] font-semibold text-[#111114] shadow-[0_0_28px_rgba(255,255,255,0.24)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/90"
            >
              Get Started Free
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </a>
            <a
              href="#enterprise"
              className="inline-flex h-[44px] items-center rounded-[10px] border border-[#8f57ff]/44 bg-black/20 px-7 text-[14px] font-semibold text-[#b78dff] shadow-[0_0_26px_rgba(133,76,255,0.10)] backdrop-blur-xl transition-all duration-300 hover:border-[#c09dff]/70 hover:text-white"
            >
              Book a Demo
            </a>
          </div>
        </div>

        <div className="pointer-events-auto relative border-t border-white/[0.10]">
          <div className="grid grid-cols-1 gap-0 sm:grid-cols-2 lg:grid-cols-5">
            {metrics.map((metric, index) => {
              const Icon = metric.icon;
              return (
                <div
                  key={metric.title}
                  className={`flex items-center justify-center gap-5 px-7 py-5 ${index > 0 ? 'lg:border-l lg:border-white/[0.10]' : ''}`}
                >
                  <Icon className="h-9 w-9 text-white/70 drop-shadow-[0_0_18px_rgba(185,166,255,0.18)]" strokeWidth={1.35} />
                  <div>
                    <div className="text-[19px] font-medium uppercase tracking-[0.11em] text-white/80">{metric.title}</div>
                    <div className="mt-1 text-[13px] font-medium text-[#b78dff]">{metric.sub}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <style>{`
        .hero-float {
          z-index: 10;
          animation: hero-float-y var(--float-duration, 8s) ease-in-out infinite;
          animation-delay: var(--float-delay, 0s);
          will-change: transform;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }

        .hero-float > .hero-glass {
          cursor: pointer;
        }

        .hero-float .hero-glass,
        .hero-float .hero-callout {
          transition:
            transform 0.55s cubic-bezier(0.2, 0.75, 0.25, 1),
            box-shadow 0.55s cubic-bezier(0.2, 0.75, 0.25, 1),
            border-color 0.5s ease;
        }

        .hero-float:hover .hero-glass,
        .hero-float:hover .hero-callout {
          transition:
            transform 0.6s cubic-bezier(0.22, 1.05, 0.32, 1.08),
            box-shadow 0.5s cubic-bezier(0.2, 0.7, 0.25, 1),
            border-color 0.45s ease;
        }

        .hero-float:hover { z-index: 15; }

        .hero-float:hover > .hero-glass {
          border-color: rgba(210, 198, 255, 0.22);
          box-shadow:
            inset 0 0 0 1px rgba(255,255,255,0.030),
            inset 0 1px 0 rgba(255,255,255,0.10),
            inset 0 0 28px rgba(168, 130, 255, 0.05),
            0 42px 120px rgba(0,0,0,0.48),
            0 0 70px rgba(141, 98, 255, 0.13),
            0 0 22px rgba(178, 144, 255, 0.08);
        }

        .hero-float:hover .hero-panel-left,
        .hero-float:hover .hero-panel-left-soft {
          transform: perspective(1100px) rotateY(6.5deg) rotateZ(-0.1deg) translate3d(0, -4px, 0);
        }
        .hero-float:hover .hero-panel-right-small,
        .hero-float:hover .hero-panel-right,
        .hero-float:hover .hero-panel-right-soft,
        .hero-float:hover .hero-panel-right-low {
          transform: perspective(1100px) rotateY(-6.5deg) rotateZ(0.1deg) translate3d(0, -4px, 0);
        }

        .hero-float:hover .hero-callout.hero-panel-left,
        .hero-float:hover .hero-callout.hero-panel-left-soft {
          transform: perspective(1600px) rotateY(9deg) rotateZ(-0.1deg) translate3d(0, -4px, 0);
        }
        .hero-float:hover .hero-callout.hero-panel-right-small,
        .hero-float:hover .hero-callout.hero-panel-right,
        .hero-float:hover .hero-callout.hero-panel-right-soft,
        .hero-float:hover .hero-callout.hero-panel-right-low {
          transform: perspective(1600px) rotateY(-9deg) rotateZ(0.1deg) translate3d(0, -4px, 0);
        }

        @keyframes hero-float-y {
          0%, 100% { transform: translate3d(0, 0, 0); }
          50% { transform: translate3d(0, -7px, 0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .hero-float { animation: none; }
        }

        .hero-glass {
          overflow: hidden;
          border: 1px solid rgba(210, 198, 255, 0.115);
          border-radius: 7px;
          background:
            linear-gradient(135deg, rgba(255,255,255,0.060), rgba(255,255,255,0.010) 39%, rgba(151,103,255,0.050)),
            rgba(4, 4, 8, 0.34);
          box-shadow:
            inset 0 0 0 1px rgba(255,255,255,0.020),
            inset 0 1px 0 rgba(255,255,255,0.075),
            0 28px 80px rgba(0,0,0,0.31),
            0 0 46px rgba(141, 98, 255, 0.045);
          backdrop-filter: url(#hero-liquid) blur(8px) saturate(140%);
          -webkit-backdrop-filter: url(#hero-liquid) blur(8px) saturate(140%);
          will-change: backdrop-filter;
          contain: layout paint style;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: geometricPrecision;
        }

        .hero-glass::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 0;
          background-image: linear-gradient(135deg, rgba(255,255,255,0.060), transparent 44%, rgba(146,92,255,0.10));
          opacity: 0.55;
          mix-blend-mode: screen;
          pointer-events: none;
        }

        .hero-glass::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 0;
          border-radius: inherit;
          background:
            linear-gradient(90deg, rgba(255,255,255,0.12), transparent 12%, transparent 86%, rgba(255,255,255,0.055)),
            linear-gradient(180deg, rgba(255,255,255,0.065), transparent 34%, rgba(142,98,255,0.052)),
            radial-gradient(circle at 12% 8%, rgba(198,178,255,0.14), transparent 24%);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.10),
            inset 0 -1px 0 rgba(156,111,255,0.09);
          pointer-events: none;
        }

        .hero-glass > * {
          position: relative;
          z-index: 1;
        }

        .hero-panel-left,
        .hero-panel-left-soft {
          transform-origin: right center;
          transform: perspective(1100px) rotateY(13deg) rotateZ(-0.2deg) translateZ(0);
        }

        .hero-panel-right-small,
        .hero-panel-right,
        .hero-panel-right-soft,
        .hero-panel-right-low {
          transform-origin: left center;
          transform: perspective(1100px) rotateY(-13deg) rotateZ(0.2deg) translateZ(0);
        }

        /* Callouts lean slightly more than their panels but stay shallow enough that small label text doesn't get smeared by perspective foreshortening */
        .hero-callout.hero-panel-left,
        .hero-callout.hero-panel-left-soft {
          transform: perspective(1600px) rotateY(15deg) rotateZ(-0.2deg) translateZ(0);
        }

        .hero-callout.hero-panel-right-small,
        .hero-callout.hero-panel-right,
        .hero-callout.hero-panel-right-soft,
        .hero-callout.hero-panel-right-low {
          transform: perspective(1600px) rotateY(-15deg) rotateZ(0.2deg) translateZ(0);
        }

        .hero-callout {
          grid-template-columns: auto minmax(86px, 1fr);
          grid-template-areas:
            "index rule"
            "label label";
          align-items: end;
          column-gap: 12px;
          row-gap: 7px;
          color: rgba(255,255,255,0.66);
          filter: drop-shadow(0 0 12px rgba(190,168,255,0.10));
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: geometricPrecision;
        }

        .hero-callout-index {
          grid-area: index;
          font-size: 10px;
          line-height: 1;
          font-weight: 700;
          letter-spacing: 0.18em;
          color: rgba(255,255,255,0.58);
        }

        .hero-callout-rule {
          grid-area: rule;
          height: 1px;
          width: 118px;
          background: linear-gradient(90deg, rgba(255,255,255,0.46), rgba(168,137,255,0.18), transparent);
          transform-origin: left center;
        }

        .hero-callout-label {
          grid-area: label;
          font-size: 11px;
          line-height: 1;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.205em;
          color: rgba(255,255,255,0.72);
          text-shadow: 0 0 14px rgba(187,160,255,0.12);
        }

        .hero-callout-left .hero-callout-rule {
          transform: scaleX(1.06);
        }

        .hero-callout-right {
          grid-template-columns: minmax(86px, 1fr) auto;
          grid-template-areas:
            "rule index"
            "label label";
          justify-items: end;
          text-align: right;
        }

        .hero-callout-right .hero-callout-rule {
          background: linear-gradient(270deg, rgba(255,255,255,0.46), rgba(168,137,255,0.18), transparent);
          transform-origin: right center;
          transform: scaleX(1.08);
        }

        @media (max-width: 1023px) {
          section h1 {
            font-size: clamp(3.2rem, 12vw, 5rem);
          }
        }

        @media (max-width: 640px) {
          section {
            min-height: 100svh;
          }

          section img {
            object-position: 57% center;
            opacity: 0.72;
          }
        }

        /* ─────────────────────────────────────────────────────────────
         * DEBUG OUTLINES — remove this whole block when done.
         *   RED    = .hero-float           (positioned wrapper, float anim, hover trigger)
         *   BLUE   = .hero-glass           (the glass material w/ backdrop refraction)
         *   GREEN  = .hero-callout-wrap    (absolute positioning shell for the label)
         *   YELLOW = .hero-callout         (the index/rule/label grid itself)
         *   MAGENTA= .hero-callout-rule    (the horizontal line)
         * Each gets a small uppercase tag in the top-left corner for clarity.
         * ───────────────────────────────────────────────────────────── */
        .hero-float {
          outline: 1px dashed rgba(255, 70, 70, 0.85);
          outline-offset: 0;
        }
        .hero-float::before {
          content: 'float';
          position: absolute;
          top: -14px;
          left: 0;
          font: 700 9px/1 ui-monospace, monospace;
          letter-spacing: 0.1em;
          color: rgba(255, 70, 70, 1);
          text-shadow: 0 0 6px #000, 0 0 6px #000;
          z-index: 50;
          pointer-events: none;
        }
        .hero-glass {
          outline: 1px solid rgba(80, 160, 255, 0.85) !important;
        }
        .hero-glass::after {
          content: 'glass' !important;
          position: absolute;
          top: 2px;
          left: 4px;
          font: 700 9px/1 ui-monospace, monospace !important;
          letter-spacing: 0.1em;
          color: rgba(80, 160, 255, 1) !important;
          background: none !important;
          box-shadow: none !important;
          text-shadow: 0 0 6px #000, 0 0 6px #000 !important;
          inset: auto !important;
          border-radius: 0 !important;
          z-index: 50;
          pointer-events: none;
        }
        .hero-callout-wrap {
          outline: 1px dashed rgba(70, 220, 130, 0.85);
        }
        .hero-callout-wrap::before {
          content: 'callout-wrap';
          position: absolute;
          top: -12px;
          left: 0;
          font: 700 9px/1 ui-monospace, monospace;
          letter-spacing: 0.1em;
          color: rgba(70, 220, 130, 1);
          text-shadow: 0 0 6px #000, 0 0 6px #000;
          z-index: 50;
          pointer-events: none;
        }
        .hero-callout {
          outline: 1px solid rgba(255, 220, 60, 0.85);
        }
        .hero-callout-rule {
          outline: 1px solid rgba(255, 80, 200, 0.85);
        }
      `}</style>
    </section>
  );
};

export default HeroSection;
