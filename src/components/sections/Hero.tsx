import React, { useState, useEffect } from 'react';
import { ArrowRight, Code, Github, Sparkles, Play, CornerRightDown } from 'lucide-react';
import GlassContainer from '../ui/GlassContainer';

interface HeroProps {
  onGetStarted: () => void;
  onTestPhase1?: () => void;
}

const Hero: React.FC<HeroProps> = ({ onGetStarted, onTestPhase1 }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [activeFeature, setActiveFeature] = useState(0);
  
  // Features data
  const features = [
    {
      title: "AI-Powered Generation",
      description: "Harness cutting-edge AI models to transform concepts into stunning visuals and engaging content."
    },
    {
      title: "Modular Components",
      description: "Build complex systems with drag-and-drop simplicity by connecting specialized AI nodes."
    },
    {
      title: "Visual Workflows",
      description: "Design and automate end-to-end creative processes through intuitive visual programming."
    }
  ];
  
  useEffect(() => {
    // Trigger entrance animation
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 100);
    
    // Auto-rotate features
    const interval = setInterval(() => {
      setActiveFeature(prev => (prev + 1) % features.length);
    }, 5000);
    
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [features.length]);

  return (
    <section className={`max-w-7xl mx-auto pb-20 pt-12 transition-opacity duration-1000 transform-gpu ${isVisible ? 'opacity-100' : 'opacity-0'} px-6`}>
      {/* Animated background elements with proper compositing */}
      <div className="fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="absolute w-full h-screen overflow-hidden">
          {/* Grid pattern */}
          <div className="absolute inset-0 opacity-[0.03]" 
            style={{
              backgroundSize: '40px 40px',
              backgroundImage: 'linear-gradient(to right, rgba(255, 255, 255, 0.2) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, 0.2) 1px, transparent 1px)',
              backgroundPosition: 'center center'
            }}>
          </div>
          
          {/* Glowing orbs optimized for GPU rendering */}
          <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-[rgba(255,255,255,0.03)] blur-[100px] opacity-50 animate-pulse-slow will-change-transform transform-gpu"></div>
          <div className="absolute bottom-1/3 right-1/4 w-80 h-80 rounded-full bg-[rgba(255,255,255,0.02)] blur-[80px] opacity-30 animate-pulse-slow will-change-transform transform-gpu" style={{animationDelay: '2s'}}></div>
        </div>
      </div>

      {/* Main hero content */}
      <div className="relative">
        {/* Floating indicator with proper positioning */}
        <div className="absolute -top-10 right-0 md:right-10 lg:right-40">
          <div className="flex items-center">
            <span className="text-sm text-text-secondary mr-2 opacity-70">Scroll to explore</span>
            <CornerRightDown size={14} className="text-text-secondary opacity-70 animate-bounce transform-gpu" />
          </div>
        </div>
        
        {/* Headline with semantic markup */}
        <div className="text-center mb-10 progressive-load">
          <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-[rgba(255,255,255,0.05)] mb-6 transform-gpu">
            <Sparkles size={14} className="mr-2 text-white" />
            <span className="text-text-secondary text-sm">Visual AI System Architecture</span>
          </div>
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
            <span className="block">Build Intelligence</span>
            <span className="block mt-1 text-text-secondary">Node by Node</span>
          </h1>
          <p className="text-lg md:text-xl text-text-secondary max-w-2xl mx-auto">
            XenoStudio empowers creators to design, connect, and deploy AI workflows through a visual programming canvas.
          </p>
        </div>

        {/* Main container with split content */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-8">
          {/* Left side - Feature panels */}
          <div className="col-span-2">
            <GlassContainer className="h-full p-6">
              <div className="space-y-6 h-full flex flex-col">
                <h2 className="text-xl font-medium">Core Features</h2>
                {/* Feature tabs with optimized transitions */}
                <div className="space-y-3 flex-grow">
                  {features.map((feature, index) => (
                    <div 
                      key={index}
                      className={`p-4 rounded-xl border cursor-pointer transform-gpu transition-all duration-300 
                        ${activeFeature === index 
                          ? 'border-white/20 bg-white/5' 
                          : 'border-transparent hover:border-white/10 hover:bg-white/[0.02]'
                        }`}
                      onClick={() => setActiveFeature(index)}
                    >
                      <h3 className={`font-medium mb-1 ${activeFeature === index ? 'text-white' : 'text-text-secondary'}`}>
                        {feature.title}
                      </h3>
                      {activeFeature === index && (
                        <p className="text-sm text-text-secondary animate-fadeIn">
                          {feature.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                
                {/* Stats at the bottom */}
                <div className="grid grid-cols-3 gap-3 pt-4 border-t border-white/5">
                  <div className="text-center">
                    <div className="text-2xl font-bold">20+</div>
                    <div className="text-xs text-text-secondary">AI Models</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">100+</div>
                    <div className="text-xs text-text-secondary">Node Types</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">∞</div>
                    <div className="text-xs text-text-secondary">Possibilities</div>
                  </div>
                </div>
              </div>
            </GlassContainer>
          </div>
          
          {/* Right side - Canvas preview */}
          <div className="col-span-3">
            <GlassContainer className="p-0 overflow-hidden">
              <div className="relative h-[400px] md:h-[500px]">
                {/* Canvas mockup optimized for rendering */}
                <div className="absolute inset-0">
                  {/* Background with grid */}
                  <div className="absolute inset-0 bg-[#1A1A1A]">
                    <div className="absolute inset-0" 
                      style={{
                        backgroundSize: '24px 24px',
                        backgroundImage: 'linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
                        backgroundPosition: 'center center'
                      }}>
                    </div>
                  </div>
                  
                  {/* Canvas nodes with optimized animations */}
                  <div className="absolute inset-0 p-8">
                    {/* Text Generator Node */}
                    <div className="absolute top-[20%] left-[15%] w-48 bg-[#1E1E1E] rounded-xl border border-white/10 shadow-lg overflow-hidden animate-pulse-slow transform-gpu will-change-transform" style={{animationDuration: '4s'}}>
                      <div className="p-3 border-b border-white/5 flex items-center justify-between">
                        <div className="flex items-center">
                          <div className="w-6 h-6 rounded bg-white/10 flex items-center justify-center mr-2">
                            <Code size={12} className="text-white" />
                          </div>
                          <span className="text-sm font-medium">Text Generator</span>
                        </div>
                      </div>
                      <div className="p-3">
                        <div className="h-2 bg-white/10 rounded-full w-full mb-2"></div>
                        <div className="h-2 bg-white/10 rounded-full w-3/4"></div>
                      </div>
                      <div className="absolute left-0 top-1/2 -ml-1.5 w-3 h-3 rounded-full bg-white/20 border border-white/10"></div>
                      <div className="absolute right-0 top-1/2 -mr-1.5 w-3 h-3 rounded-full bg-white/30 border border-white/10"></div>
                    </div>
                    
                    {/* Image Generator Node */}
                    <div className="absolute top-[30%] right-[15%] w-48 bg-[#1E1E1E] rounded-xl border border-white/10 shadow-lg overflow-hidden animate-pulse-slow transform-gpu will-change-transform" style={{animationDuration: '5s', animationDelay: '1s'}}>
                      <div className="p-3 border-b border-white/5 flex items-center justify-between">
                        <div className="flex items-center">
                          <div className="w-6 h-6 rounded bg-white/10 flex items-center justify-center mr-2">
                            <Github size={12} className="text-white" />
                          </div>
                          <span className="text-sm font-medium">Image Generator</span>
                        </div>
                      </div>
                      <div className="p-3">
                        <div className="h-2 bg-white/10 rounded-full w-full mb-2"></div>
                        <div className="h-2 bg-white/10 rounded-full w-2/3"></div>
                      </div>
                      <div className="absolute left-0 top-1/2 -ml-1.5 w-3 h-3 rounded-full bg-white/20 border border-white/10"></div>
                      <div className="absolute right-0 top-1/2 -mr-1.5 w-3 h-3 rounded-full bg-white/30 border border-white/10"></div>
                    </div>
                    
                    {/* Output Node */}
                    <div className="absolute bottom-[20%] left-[35%] w-48 bg-[#1E1E1E] rounded-xl border border-white/10 shadow-lg overflow-hidden animate-pulse-slow transform-gpu will-change-transform" style={{animationDuration: '6s', animationDelay: '0.5s'}}>
                      <div className="p-3 border-b border-white/5 flex items-center justify-between">
                        <div className="flex items-center">
                          <div className="w-6 h-6 rounded bg-white/10 flex items-center justify-center mr-2">
                            <Play size={12} className="text-white" />
                          </div>
                          <span className="text-sm font-medium">Result Viewer</span>
                        </div>
                      </div>
                      <div className="p-3">
                        <div className="h-2 bg-white/10 rounded-full w-full mb-2"></div>
                        <div className="h-2 bg-white/10 rounded-full w-1/2"></div>
                      </div>
                      <div className="absolute left-0 top-1/2 -ml-1.5 w-3 h-3 rounded-full bg-white/20 border border-white/10"></div>
                    </div>
                    
                    {/* Connection lines with optimized animations */}
                    <svg className="absolute inset-0 w-full h-full">
                      <path 
                        d="M 120,120 C 180,120 280,170 380,170" 
                        stroke="rgba(255,255,255,0.2)" 
                        strokeWidth="1.5" 
                        fill="none"
                        strokeDasharray="5,5"
                        className="animate-pathDraw"
                      />
                      <path 
                        d="M 380,170 C 280,170 200,320 220,320" 
                        stroke="rgba(255,255,255,0.2)" 
                        strokeWidth="1.5" 
                        fill="none"
                        strokeDasharray="5,5"
                        className="animate-pathDraw"
                        style={{animationDelay: '1s'}}
                      />
                    </svg>
                  </div>
                  
                  {/* Controls overlay */}
                  <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 transform-gpu">
                    <div className="bg-[rgba(255,255,255,0.05)] backdrop-blur-[10px] py-2 px-4 rounded-full border border-[rgba(255,255,255,0.1)] flex items-center space-x-4 shadow-glass">
                      <button className="text-sm text-white opacity-70 hover:opacity-100 transition-opacity">Language</button>
                      <button className="text-sm text-white opacity-70 hover:opacity-100 transition-opacity">Image</button>
                      <button className="text-sm text-white opacity-70 hover:opacity-100 transition-opacity">Video</button>
                      <div className="h-4 w-px bg-white/10"></div>
                      <span className="text-xs bg-white/10 px-2 py-0.5 rounded">100%</span>
                    </div>
                  </div>
                </div>
              </div>
            </GlassContainer>
          </div>
        </div>
        
        {/* CTA Buttons with optimized hover effects */}
        <div className="flex justify-center mt-10">
          <button className="relative group w-full sm:w-auto bg-[rgba(255,255,255,0.05)] backdrop-blur-[10px] border border-[rgba(255,255,255,0.1)] px-8 py-3 rounded-xl font-medium transition-all duration-300 transform-gpu hover:bg-[rgba(255,255,255,0.08)] hover:scale-[1.02]">
            <div className="flex items-center justify-center">
              <span>Watch Demo</span>
              <Play size={18} className="ml-2 transition-transform duration-300 transform-gpu group-hover:translate-x-1" />
            </div>
          </button>
        </div>
        
        {/* Bottom info bar */}
        <div className="mt-16 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center text-text-secondary text-sm">
          <div className="mb-4 md:mb-0">
            Built with modern web technologies and cutting-edge AI models
          </div>
          <div className="flex space-x-8">
            <div className="flex items-center">
              <div className="w-2 h-2 rounded-full bg-white/40 mr-2"></div>
              <span>Real-time Processing</span>
            </div>
            <div className="flex items-center">
              <div className="w-2 h-2 rounded-full bg-white/40 mr-2"></div>
              <span>Open Architecture</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;