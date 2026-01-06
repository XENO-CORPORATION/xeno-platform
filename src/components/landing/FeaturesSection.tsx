import React, { useState, useRef, useEffect } from 'react';
import { 
  Cpu, 
  Workflow, 
  Shield, 
  Gauge,
  ChevronRight
} from 'lucide-react';

const FeaturesSection: React.FC = () => {
  const [activeFeature, setActiveFeature] = useState(0);
  const [isInView, setIsInView] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  const features = [
    {
      id: 0,
      icon: Cpu,
      title: '20+ AI Models',
      subtitle: 'One subscription',
      description: 'Stable Diffusion, Flux, GPT-4, Claude, Gemini—access the full spectrum of generative AI through a single, unified interface. No API juggling required.',
      highlights: ['SDXL', 'Flux Pro', 'GPT-4', 'Claude 3'],
    },
    {
      id: 1,
      icon: Workflow,
      title: 'Visual Workflows',
      subtitle: 'Zero code',
      description: 'Design complex multi-step pipelines by connecting nodes on an infinite canvas. What used to require engineering teams now takes minutes.',
      highlights: ['Drag & drop', 'Live preview', 'Templates', 'Version history'],
    },
    {
      id: 2,
      icon: Shield,
      title: 'Enterprise Ready',
      subtitle: 'Built for scale',
      description: 'SOC 2 compliant infrastructure with end-to-end encryption. Deploy on our cloud or yours. Your data stays yours.',
      highlights: ['SOC 2 Type II', 'E2E encryption', 'Private cloud', 'SSO & SAML'],
    },
    {
      id: 3,
      icon: Gauge,
      title: 'Instant Results',
      subtitle: 'GPU-accelerated',
      description: 'Purpose-built infrastructure delivers generations in seconds. Watch your workflows execute in real-time with live progress tracking.',
      highlights: ['< 3s average', 'GPU clusters', 'Auto-scaling', 'Global CDN'],
    },
  ];

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setIsInView(entry.isIntersecting),
      { threshold: 0.2 }
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveFeature((prev) => (prev + 1) % features.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [features.length]);

  return (
    <section ref={sectionRef} className="relative py-28 px-6 lg:px-8 bg-[#08080a] overflow-hidden">
      <div className="max-w-[1200px] mx-auto">
        {/* Header */}
        <div className="mb-16">
          <p className="text-[13px] text-white/40 uppercase tracking-[0.15em] font-medium mb-4">
            How it works
          </p>
          <h2 className="text-[clamp(2rem,5vw,3.25rem)] font-semibold text-white tracking-[-0.02em] leading-[1.15]">
            Professional tools.<br />
            <span className="text-white/30">Zero learning curve.</span>
          </h2>
        </div>

        {/* Feature showcase */}
        <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-start">
          {/* Left: Feature list */}
          <div className="space-y-2">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              const isActive = activeFeature === index;
              
              return (
                <button
                  key={feature.id}
                  onClick={() => setActiveFeature(index)}
                  className={`w-full text-left p-6 rounded-2xl transition-all duration-500 group ${
                    isActive 
                      ? 'bg-white/[0.04] border border-white/[0.08]' 
                      : 'border border-transparent hover:bg-white/[0.02]'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-300 ${
                      isActive ? 'bg-white/10' : 'bg-white/[0.04]'
                    }`}>
                      <Icon size={22} className={`transition-colors ${isActive ? 'text-white' : 'text-white/50'}`} />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className={`text-lg font-semibold transition-colors ${isActive ? 'text-white' : 'text-white/70'}`}>
                          {feature.title}
                        </h3>
                        <ChevronRight 
                          size={18} 
                          className={`transition-all duration-300 ${
                            isActive ? 'text-white/60 rotate-90' : 'text-white/20 group-hover:text-white/40'
                          }`} 
                        />
                      </div>
                      <p className="text-sm text-white/40">{feature.subtitle}</p>
                      
                      {/* Expanded content */}
                      <div className={`overflow-hidden transition-all duration-500 ${isActive ? 'max-h-40 opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
                        <p className="text-white/50 text-sm leading-relaxed mb-4">
                          {feature.description}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {feature.highlights.map((highlight, i) => (
                            <span 
                              key={i}
                              className="px-3 py-1 text-xs text-white/50 bg-white/[0.04] rounded-full border border-white/[0.06]"
                            >
                              {highlight}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Progress bar for active item */}
                  {isActive && (
                    <div className="mt-4 h-0.5 bg-white/[0.06] rounded-full overflow-hidden">
                      <div className="h-full bg-white/30 rounded-full animate-progress" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Right: Visual preview */}
          <div className="relative lg:sticky lg:top-32">
            <div className="aspect-[4/3] rounded-2xl bg-gradient-to-br from-white/[0.04] to-transparent border border-white/[0.06] overflow-hidden">
              {/* Canvas preview mock */}
              <div className="absolute inset-0 p-8">
                {/* Grid background */}
                <div 
                  className="absolute inset-0 opacity-30"
                  style={{
                    backgroundImage: `
                      linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
                    `,
                    backgroundSize: '32px 32px',
                  }}
                />
                
                {/* Animated nodes based on active feature */}
                <div className="relative h-full">
                  {/* Node 1 */}
                  <div 
                    className={`absolute transition-all duration-700 ${
                      activeFeature === 0 ? 'top-[10%] left-[10%] scale-100 opacity-100' :
                      activeFeature === 1 ? 'top-[15%] left-[5%] scale-90 opacity-80' :
                      activeFeature === 2 ? 'top-[20%] left-[15%] scale-85 opacity-60' :
                      'top-[10%] left-[10%] scale-100 opacity-100'
                    }`}
                  >
                    <div className="w-40 bg-[#1a1a1a] rounded-xl border border-white/10 overflow-hidden shadow-xl">
                      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-400" />
                        <span className="text-xs text-white/70">Text Input</span>
                      </div>
                      <div className="p-3 space-y-2">
                        <div className="h-2 bg-white/10 rounded w-full" />
                        <div className="h-2 bg-white/10 rounded w-3/4" />
                      </div>
                    </div>
                  </div>
                  
                  {/* Node 2 */}
                  <div 
                    className={`absolute transition-all duration-700 delay-100 ${
                      activeFeature === 0 ? 'top-[40%] left-[40%] scale-100 opacity-100' :
                      activeFeature === 1 ? 'top-[35%] left-[35%] scale-110 opacity-100' :
                      activeFeature === 2 ? 'top-[45%] left-[45%] scale-90 opacity-70' :
                      'top-[35%] left-[50%] scale-105 opacity-90'
                    }`}
                  >
                    <div className="w-44 bg-[#1a1a1a] rounded-xl border border-white/10 overflow-hidden shadow-xl">
                      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-400" />
                        <span className="text-xs text-white/70">AI Generator</span>
                      </div>
                      <div className="p-3">
                        <div className="aspect-video bg-white/5 rounded-lg flex items-center justify-center">
                          <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Node 3 */}
                  <div 
                    className={`absolute transition-all duration-700 delay-200 ${
                      activeFeature === 0 ? 'bottom-[15%] right-[10%] scale-100 opacity-100' :
                      activeFeature === 1 ? 'bottom-[20%] right-[15%] scale-95 opacity-90' :
                      activeFeature === 2 ? 'bottom-[10%] right-[5%] scale-105 opacity-100' :
                      'bottom-[15%] right-[10%] scale-100 opacity-100'
                    }`}
                  >
                    <div className="w-36 bg-[#1a1a1a] rounded-xl border border-white/10 overflow-hidden shadow-xl">
                      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-purple-400" />
                        <span className="text-xs text-white/70">Output</span>
                      </div>
                      <div className="p-3">
                        <div className="aspect-square bg-gradient-to-br from-white/10 to-white/5 rounded-lg" />
                      </div>
                    </div>
                  </div>
                  
                  {/* Connection lines */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none">
                    <path
                      d="M 180 80 Q 280 120 320 180"
                      stroke="rgba(255,255,255,0.15)"
                      strokeWidth="2"
                      fill="none"
                      strokeDasharray="6 4"
                      className="animate-dash"
                    />
                    <path
                      d="M 380 220 Q 420 280 380 320"
                      stroke="rgba(255,255,255,0.15)"
                      strokeWidth="2"
                      fill="none"
                      strokeDasharray="6 4"
                      className="animate-dash"
                      style={{ animationDelay: '0.5s' }}
                    />
                  </svg>
                </div>
              </div>
              
              {/* Floating label */}
              <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center">
                <span className="text-xs text-white/30">Live preview</span>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-xs text-white/30">Connected</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <style>{`
        @keyframes progress {
          from { width: 0; }
          to { width: 100%; }
        }
        .animate-progress {
          animation: progress 5s linear;
        }
        @keyframes dash {
          to { stroke-dashoffset: -20; }
        }
        .animate-dash {
          animation: dash 1s linear infinite;
        }
      `}</style>
    </section>
  );
};

export default FeaturesSection;
