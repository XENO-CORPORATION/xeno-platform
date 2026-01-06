import React from 'react';

const LogoStrip: React.FC = () => {
  const logos = [
    { name: 'Adobe', width: 80 },
    { name: 'Figma', width: 70 },
    { name: 'Notion', width: 85 },
    { name: 'Linear', width: 75 },
    { name: 'Vercel', width: 80 },
    { name: 'Stripe', width: 70 },
    { name: 'Spotify', width: 85 },
    { name: 'Airbnb', width: 75 },
  ];

  return (
    <section className="relative py-20 px-6 bg-[#0a0a0a] border-y border-white/[0.04]">
      <div className="max-w-[1400px] mx-auto">
        <p className="text-center text-sm text-white/30 uppercase tracking-[0.2em] mb-12 font-medium">
          Trusted by creative teams worldwide
        </p>
        
        <div className="relative overflow-hidden">
          {/* Fade edges */}
          <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-[#0a0a0a] to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-[#0a0a0a] to-transparent z-10 pointer-events-none" />
          
          {/* Scrolling logos */}
          <div className="flex items-center gap-16 animate-scroll">
            {[...logos, ...logos].map((logo, i) => (
              <div 
                key={i} 
                className="flex-shrink-0 h-8 flex items-center justify-center opacity-30 hover:opacity-60 transition-opacity duration-300"
                style={{ minWidth: logo.width }}
              >
                <span className="text-white text-lg font-semibold tracking-tight whitespace-nowrap">
                  {logo.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      <style>{`
        @keyframes scroll {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
        .animate-scroll {
          animation: scroll 30s linear infinite;
        }
        .animate-scroll:hover {
          animation-play-state: paused;
        }
      `}</style>
    </section>
  );
};

export default LogoStrip;
