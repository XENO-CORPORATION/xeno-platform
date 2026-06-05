import React from 'react';

interface CreatorCard {
  title: string;
  subtitle: string;
  /**
   * Tailwind background gradient. Replace with `<img />` once real assets land.
   */
  gradient: string;
  accentClass?: string;
}

const cards: CreatorCard[] = [
  {
    title: 'Marketing',
    subtitle: 'Campaigns that convert.',
    gradient:
      'bg-[radial-gradient(ellipse_at_50%_30%,rgba(170,140,255,0.22),transparent_55%),linear-gradient(180deg,#171420_0%,#090909_70%)]',
  },
  {
    title: 'Product Design',
    subtitle: 'Concepts that come to life.',
    gradient:
      'bg-[radial-gradient(ellipse_at_55%_40%,rgba(120,100,200,0.18),transparent_55%),linear-gradient(180deg,#11101a_0%,#090909_70%)]',
  },
  {
    title: 'Content Creation',
    subtitle: 'Produce more. Create impact.',
    gradient:
      'bg-[radial-gradient(ellipse_at_50%_35%,rgba(255,140,90,0.14),transparent_55%),linear-gradient(180deg,#1a1410_0%,#090909_70%)]',
  },
  {
    title: 'Game Development',
    subtitle: 'Build worlds. Faster.',
    gradient:
      'bg-[radial-gradient(ellipse_at_50%_40%,rgba(110,170,255,0.16),transparent_55%),linear-gradient(180deg,#0e1320_0%,#090909_70%)]',
  },
  {
    title: 'Architecture & 3D',
    subtitle: 'Design with precision.',
    gradient:
      'bg-[radial-gradient(ellipse_at_50%_50%,rgba(220,200,160,0.14),transparent_55%),linear-gradient(180deg,#181614_0%,#090909_70%)]',
  },
  {
    title: 'Business & Teams',
    subtitle: 'Work smarter. Together.',
    gradient:
      'bg-[radial-gradient(ellipse_at_50%_45%,rgba(150,200,200,0.14),transparent_55%),linear-gradient(180deg,#10171a_0%,#090909_70%)]',
  },
];

const UseCasesShowcase: React.FC = () => {
  return (
    <section className="bg-[#060606] px-[1vw] py-[clamp(64px,9vh,120px)]">
      <div className="mx-auto w-full">
        <h2 className="mb-[clamp(40px,6vh,80px)] text-center text-[clamp(1.8rem,2.4vw,3rem)] font-light tracking-tight text-white">
          Built for every kind of creator.
        </h2>

        <div className="grid grid-cols-2 gap-[1vw] sm:grid-cols-3 lg:grid-cols-6">
          {cards.map((card) => (
            <article
              key={card.title}
              className={`group relative aspect-[3/5] overflow-hidden rounded-[16px] border border-white/[0.07] ${card.gradient}`}
            >
              {/* subtle inner highlight on the top edge */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent_50%)]" />

              {/* image placeholder — swap this div for an <img /> when assets land */}
              <div className="absolute inset-x-6 inset-y-8 bottom-[42%] rounded-[8px] border border-white/[0.04] bg-white/[0.015]" />

              {/* bottom fade so text sits cleanly */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.85))]" />

              {/* text */}
              <div className="absolute inset-x-0 bottom-0 p-[clamp(16px,1.4vw,24px)]">
                <h3 className="text-[clamp(13px,1vw,17px)] font-semibold text-white">{card.title}</h3>
                <p className="mt-1.5 text-[clamp(11px,0.8vw,13px)] leading-[1.4] text-[#8a847b]">{card.subtitle}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default UseCasesShowcase;
