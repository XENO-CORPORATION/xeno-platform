import React from 'react';
import { ArrowUpRight, Megaphone, PenTool, Clapperboard, Gamepad2, Building2, Users } from 'lucide-react';
import { Reveal, SectionHeading, cx } from './primitives';

interface Persona {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  apps: string[];
  image: string;
  fallback: string;
  span: string;
}

const personas: Persona[] = [
  {
    title: 'Marketing',
    subtitle: 'Campaigns that convert — from first concept to every channel.',
    icon: Megaphone,
    apps: ['Gen', 'Pixel', 'Motion', 'Post'],
    image: '/landing-v3/usecases/marketing.png',
    fallback: 'radial-gradient(ellipse at 70% 35%, rgba(170,140,255,0.28), transparent 60%), linear-gradient(165deg,#171420,#070707 72%)',
    span: 'md:col-span-2 lg:col-span-4',
  },
  {
    title: 'Product Design',
    subtitle: 'Concepts that come to life.',
    icon: PenTool,
    apps: ['Canvas', 'Pixel', '3D'],
    image: '/landing-v3/usecases/product-design.png',
    fallback: 'radial-gradient(ellipse at 65% 40%, rgba(120,100,200,0.24), transparent 60%), linear-gradient(165deg,#11101a,#070707 72%)',
    span: 'lg:col-span-2',
  },
  {
    title: 'Content Creation',
    subtitle: 'Produce more. Create impact.',
    icon: Clapperboard,
    apps: ['Motion', 'Sound', 'Gen'],
    image: '/landing-v3/usecases/content-creation.png',
    fallback: 'radial-gradient(ellipse at 65% 40%, rgba(255,140,90,0.18), transparent 60%), linear-gradient(165deg,#1a1410,#070707 72%)',
    span: 'lg:col-span-2',
  },
  {
    title: 'Game Development',
    subtitle: 'Build worlds. Faster.',
    icon: Gamepad2,
    apps: ['Engine', '3D', 'Sound'],
    image: '/landing-v3/usecases/game-dev.png',
    fallback: 'radial-gradient(ellipse at 65% 40%, rgba(110,170,255,0.20), transparent 60%), linear-gradient(165deg,#0e1320,#070707 72%)',
    span: 'lg:col-span-2',
  },
  {
    title: 'Architecture & 3D',
    subtitle: 'Design with precision.',
    icon: Building2,
    apps: ['Architect', '3D', 'Canvas'],
    image: '/landing-v3/usecases/architecture.png',
    fallback: 'radial-gradient(ellipse at 65% 45%, rgba(220,200,160,0.18), transparent 60%), linear-gradient(165deg,#181614,#070707 72%)',
    span: 'lg:col-span-2',
  },
  {
    title: 'Business & Teams',
    subtitle: 'Work smarter, together — docs, comms, automation and agents in one place.',
    icon: Users,
    apps: ['Office', 'Comms', 'Workflow', 'Agent'],
    image: '/landing-v3/usecases/business.png',
    fallback: 'radial-gradient(ellipse at 75% 50%, rgba(150,200,200,0.18), transparent 55%), linear-gradient(165deg,#10171a,#070707 72%)',
    span: 'md:col-span-2 lg:col-span-6',
  },
];

const UseCasesShowcase: React.FC = () => {
  return (
    <section id="innovate" className="page-gutter scroll-mt-14 border-t border-white/[0.06] bg-[#060606] py-[clamp(80px,11vh,150px)]">
      <SectionHeading
        eyebrow="Made for makers"
        title="Built for every kind of creator."
        sub="Whatever you make, XENO adapts to your craft — and the right apps are always one workspace away."
      />

      <div className="mx-auto mt-[clamp(40px,6vh,72px)] grid grid-cols-1 gap-[clamp(14px,1vw,20px)] md:grid-cols-2 lg:grid-cols-6">
        {personas.map((p, i) => (
          <Reveal
            as="article"
            key={p.title}
            delay={(i % 3) * 70}
            className={cx(
              'group relative flex min-h-[clamp(210px,25vh,280px)] flex-col overflow-hidden rounded-[16px] border border-white/[0.07] p-[clamp(20px,1.7vw,32px)] transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.18]',
              p.span,
            )}
            style={{ background: p.fallback }}
          >
            {/* background image */}
            <img
              src={p.image}
              alt=""
              aria-hidden="true"
              loading="lazy"
              className="pointer-events-none absolute inset-0 h-full w-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.06]"
            />
            {/* legibility overlay — dark on the left + bottom where text sits */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'linear-gradient(100deg, rgba(6,6,6,0.94) 0%, rgba(6,6,6,0.6) 42%, rgba(6,6,6,0.12) 100%), linear-gradient(0deg, rgba(6,6,6,0.88) 0%, rgba(6,6,6,0.2) 45%, transparent 70%)',
              }}
            />

            <div className="relative z-10 grid h-[clamp(40px,3.4vw,52px)] w-[clamp(40px,3.4vw,52px)] place-items-center rounded-[12px] border border-white/[0.16] bg-white/[0.06] text-[#e8e3db] backdrop-blur-sm">
              <p.icon className="h-[44%] w-[44%]" strokeWidth={1.6} />
            </div>

            <div className="relative z-10 mt-auto pt-6">
              <h3 className="text-[clamp(16px,1.25vw,22px)] font-semibold leading-tight text-white">{p.title}</h3>
              <p className="mt-2 max-w-[420px] text-[clamp(12px,0.82vw,14px)] leading-[1.5] text-[#b3aca2]">{p.subtitle}</p>

              <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                {p.apps.map((a) => (
                  <span key={a} className="rounded-[4px] border border-white/[0.12] bg-black/30 px-2.5 py-0.5 text-[10.5px] font-medium text-[#c2bbb1] backdrop-blur-sm transition-colors group-hover:border-white/[0.22] group-hover:text-white">
                    {a}
                  </span>
                ))}
                <ArrowUpRight className="ml-1 h-4 w-4 -translate-x-1 text-[#8a847b] opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-white group-hover:opacity-100" />
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
};

export default UseCasesShowcase;
