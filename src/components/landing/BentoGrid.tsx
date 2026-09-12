import React, { useState, useEffect, useRef } from 'react';

/* ─── Bento grid items ─── */

const BENTO_ITEMS = [
  {
    id: 'models',
    area: 'models',
    stat: '20+',
    label: 'AI Models',
    type: 'stat' as const,
  },
  {
    id: 'speed',
    area: 'speed',
    label: 'Industry-leading\ninference speed',
    type: 'hero' as const,
    bg: '/hero-assets/hero-fluid.jpg',
  },
  {
    id: 'fourk',
    area: 'fourk',
    stat: '4K',
    label: 'Native image generation',
    type: 'stat-image' as const,
    bg: '/hero-assets/hero-neural.jpg',
  },
  {
    id: 'workflows',
    area: 'workflows',
    label: 'Visual Workflows',
    desc: 'Node-based AI pipelines\nwith zero code',
    type: 'feature' as const,
    bg: '/hero-assets/hero-workspace.jpg',
  },
  {
    id: 'ui',
    area: 'ui',
    label: 'Minimalist UI',
    type: 'mirror' as const,
  },
  {
    id: 'office',
    area: 'office',
    label: 'Full Office Suite',
    desc: 'PDF, Word, Spreadsheets,\nPresentations',
    type: 'feature' as const,
    bg: '/hero-assets/hero-architecture.jpg',
  },
  {
    id: 'privacy',
    area: 'privacy',
    stat: 'Do not train',
    label: 'Safely generate proprietary data',
    type: 'stat' as const,
  },
  {
    id: 'realtime',
    area: 'realtime',
    label: 'Realtime Canvas',
    type: 'hero-small' as const,
    bg: '/hero-assets/hero-abstract.webp',
  },
  {
    id: 'threed',
    area: 'threed',
    label: 'Text to 3D',
    type: 'cube' as const,
  },
  {
    id: 'chat',
    area: 'chat',
    label: 'Chat with AI',
    desc: 'GPT-4, Claude, Gemini,\nLlama — all in one place',
    type: 'feature' as const,
  },
  {
    id: 'edge',
    area: 'edge',
    label: 'Bleeding Edge',
    desc: 'Access the latest models\ndirectly on release day',
    type: 'clock' as const,
  },
];

/* ─── Rotating 3D cube ─── */

function RotatingCube() {
  const [rotation, setRotation] = useState({ x: -15, y: 45 });

  useEffect(() => {
    let frame: number;
    let t = 0;
    const animate = () => {
      t += 0.008;
      setRotation({
        x: -15 + Math.sin(t * 0.7) * 10,
        y: 45 + t * 40,
      });
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  const size = '2.5rem';
  const faces = [
    { transform: `rotateY(0deg) translateZ(calc(${size}/2))`, shadow: 0.05 },
    { transform: `rotateY(180deg) translateZ(calc(${size}/2))`, shadow: 0.2 },
    { transform: `rotateY(90deg) translateZ(calc(${size}/2))`, shadow: 0.15 },
    { transform: `rotateY(270deg) translateZ(calc(${size}/2))`, shadow: 0.15 },
    { transform: `rotateX(90deg) translateZ(calc(${size}/2))`, shadow: 0 },
    { transform: `rotateX(-90deg) translateZ(calc(${size}/2))`, shadow: 0 },
  ];

  return (
    <div className="relative mx-auto" style={{ width: size, height: size, perspective: '400px' }}>
      <div
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
          width: '100%',
          height: '100%',
          position: 'relative',
        }}
      >
        {faces.map((face, i) => (
          <div
            key={i}
            className="absolute bg-white"
            style={{
              width: '100%',
              height: '100%',
              transform: face.transform,
              backfaceVisibility: 'hidden',
            }}
          >
            <div className="w-full h-full" style={{ backgroundColor: `rgba(0,0,0,${face.shadow})` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Analog clock ─── */

function AnalogClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const hours = time.getHours() % 12;
  const minutes = time.getMinutes();
  const seconds = time.getSeconds();

  const hourAngle = (hours + minutes / 60) * 30;
  const minuteAngle = (minutes + seconds / 60) * 6;
  const secondAngle = seconds * 6;

  return (
    <svg viewBox="0 0 200 200" className="block select-none" width="120" height="120">
      <circle cx="100" cy="100" r="95" className="fill-[#f5f5f5]" stroke="white" strokeWidth="1" />
      {/* Hour numbers */}
      {Array.from({ length: 12 }, (_, i) => {
        const angle = ((i + 1) * 30 - 90) * (Math.PI / 180);
        const x = 100 + 78 * Math.cos(angle);
        const y = 100 + 78 * Math.sin(angle);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="#111" fontSize="11" fontWeight="500">
            {i + 1}
          </text>
        );
      })}
      {/* Tick marks */}
      {Array.from({ length: 60 }, (_, i) => {
        if (i % 5 === 0) return null;
        const angle = (i * 6 - 90) * (Math.PI / 180);
        const x1 = 100 + 90 * Math.cos(angle);
        const y1 = 100 + 90 * Math.sin(angle);
        const x2 = 100 + 86 * Math.cos(angle);
        const y2 = 100 + 86 * Math.sin(angle);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ccc" strokeWidth="0.75" />;
      })}
      {/* Hour hand */}
      <g transform={`rotate(${hourAngle}, 100, 100)`}>
        <line x1="100" y1="100" x2="100" y2="50" stroke="#222" strokeWidth="6" strokeLinecap="round" />
      </g>
      {/* Minute hand */}
      <g transform={`rotate(${minuteAngle}, 100, 100)`}>
        <line x1="100" y1="100" x2="100" y2="35" stroke="#222" strokeWidth="4" strokeLinecap="round" />
      </g>
      {/* Second hand */}
      <g transform={`rotate(${secondAngle}, 100, 100)`}>
        <line x1="100" y1="110" x2="100" y2="30" stroke="#FFC32F" strokeWidth="1.5" strokeLinecap="round" />
      </g>
      <circle cx="100" cy="100" r="4" fill="#FFC32F" />
      <circle cx="100" cy="100" r="2.5" fill="#FFC32F" />
    </svg>
  );
}

/* ─── Bento card renderer ─── */

function BentoCard({ item }: { item: (typeof BENTO_ITEMS)[number] }) {
  switch (item.type) {
    case 'stat':
      return (
        <div className="bg-[#111113] flex flex-col items-center justify-center rounded-3xl p-6 h-full">
          <span className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent text-5xl xl:text-7xl font-bold tracking-tight leading-none">
            {item.stat}
          </span>
          <span className="text-base font-semibold leading-none mt-2 text-white/80 xl:text-lg">{item.label}</span>
        </div>
      );

    case 'stat-image':
      return (
        <div className="relative flex flex-col items-center justify-center rounded-3xl overflow-hidden h-full">
          <img src={item.bg} className="absolute inset-0 w-full h-full object-cover" alt="" loading="lazy" />
          <div className="absolute inset-0" style={{ background: 'radial-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.5))' }} />
          <span className="relative z-10 text-5xl xl:text-7xl font-bold tracking-tight leading-none text-white">{item.stat}</span>
          <span className="relative z-10 text-base font-medium leading-none mt-2 text-white/80 xl:text-lg text-center">{item.label}</span>
        </div>
      );

    case 'hero':
      return (
        <div className="relative flex flex-col items-center justify-center rounded-3xl overflow-hidden h-full min-h-[220px]">
          <img src={item.bg} className="absolute inset-0 w-full h-full object-cover" alt="" loading="lazy" />
          <div className="absolute inset-0" style={{ background: 'radial-gradient(rgba(0,0,0,0.2), rgba(0,0,0,0.4))' }} />
          <span className="relative z-10 text-center text-3xl md:text-4xl font-semibold text-white leading-tight whitespace-pre-line">
            {item.label}
          </span>
        </div>
      );

    case 'hero-small':
      return (
        <div className="relative flex flex-col items-center justify-center rounded-3xl overflow-hidden h-full">
          <img src={item.bg} className="absolute inset-0 w-full h-full object-cover" alt="" loading="lazy" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(rgba(0,0,0,0.1), rgba(0,0,0,0.5))' }} />
          <span className="relative z-10 text-center text-2xl font-semibold text-white">{item.label}</span>
        </div>
      );

    case 'feature':
      return (
        <div className="relative flex flex-col rounded-3xl overflow-hidden h-full">
          {item.bg && <img src={item.bg} className="absolute inset-0 w-full h-full object-cover" alt="" loading="lazy" />}
          {item.bg && (
            <div className="absolute inset-0" style={{ background: 'linear-gradient(rgba(0,0,0,0.8), rgba(0,0,0,0.2))' }} />
          )}
          {!item.bg && <div className="absolute inset-0 bg-[#111113]" />}
          <div className="relative z-10 p-5 flex flex-col h-full justify-end">
            <div className="text-xl font-semibold text-white leading-tight">{item.label}</div>
            {item.desc && (
              <div className="text-sm font-medium text-white/50 mt-1.5 whitespace-pre-line">{item.desc}</div>
            )}
          </div>
        </div>
      );

    case 'mirror':
      return (
        <div className="bg-[#111113] flex flex-col items-center justify-center rounded-3xl overflow-hidden h-full relative">
          <div className="relative text-center text-3xl font-semibold text-white leading-none">
            {item.label}
            <div
              className="absolute -bottom-full -scale-y-100 text-3xl font-semibold opacity-40 blur-[2px] left-0 right-0"
              aria-hidden="true"
              style={{
                background: 'linear-gradient(to top, white 0%, transparent 80%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {item.label}
            </div>
          </div>
        </div>
      );

    case 'cube':
      return (
        <div className="bg-[#111113] flex flex-col items-center justify-center gap-3 rounded-3xl h-full p-4">
          <span className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent text-2xl font-semibold">
            {item.label}
          </span>
          <RotatingCube />
        </div>
      );

    case 'clock':
      return (
        <div className="bg-[#111113] flex flex-col items-center justify-start gap-2 rounded-3xl h-full p-5">
          <div className="text-xl font-semibold text-white w-full text-center">{item.label}</div>
          <AnalogClock />
          {item.desc && (
            <div className="text-center text-sm font-medium text-white/50 mt-1 whitespace-pre-line">{item.desc}</div>
          )}
        </div>
      );

    default:
      return null;
  }
}

/* ─── Main component ─── */

const BentoGrid: React.FC = () => {
  return (
    <section className="relative py-24 md:py-40 px-4 lg:px-6 bg-[#08080a] overflow-hidden">
      <div className="max-w-[1920px] mx-auto">
        <div className="bento-grid gap-3.5">
          {BENTO_ITEMS.map((item) => (
            <div key={item.id} style={{ gridArea: item.area }} className="min-h-0">
              <BentoCard item={item} />
            </div>
          ))}
        </div>
      </div>

      {/* Subtle background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-white/[0.008] rounded-full blur-[150px] pointer-events-none" />

      <style>{`
        .bento-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          grid-template-rows: auto;
          grid-template-areas:
            "speed speed fourk fourk"
            "models workflows workflows ui"
            "office office privacy privacy"
            "realtime threed chat edge";
        }
        .bento-grid > div {
          min-height: 200px;
        }
        @media (min-width: 1024px) {
          .bento-grid {
            grid-template-columns: repeat(5, 1fr);
            grid-template-rows: 220px 200px 220px;
            grid-template-areas:
              "speed speed fourk models ui"
              "workflows workflows office office privacy"
              "realtime threed chat chat edge";
          }
        }
      `}</style>
    </section>
  );
};

export default BentoGrid;
