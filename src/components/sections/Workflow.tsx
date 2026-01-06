import React, { useState } from 'react';
import { Workflow as WorkflowIcon, ArrowRight, ChevronRight, Monitor, Zap, Code, CommandIcon } from 'lucide-react';
import GlassContainer from '../ui/GlassContainer';

const Workflow: React.FC = () => {
  const [activeStep, setActiveStep] = useState(0);
  
  const steps = [
    {
      title: "Design",
      description: "Drag and drop block nodes onto the canvas to build your custom lab environment with a visual interface.",
      icon: <Monitor size={24} />,
      detail: "Begin by laying out your AI workflow on the canvas. Select from various specialized nodes including LLM agents, image generators, and video processors. Each node represents a powerful AI capability that can be customized to your needs."
    },
    {
      title: "Connect",
      description: "Create powerful data flows by connecting nodes together, forming an intelligent network of AI components.",
      icon: <Zap size={24} />,
      detail: "Link nodes by drawing connections between outputs and inputs. This intuitive visual programming approach allows you to create complex workflows without writing code. The connections define how data flows through your system and how each component influences the next."
    },
    {
      title: "Configure",
      description: "Fine-tune each node with precise parameters and settings to achieve your exact creative vision.",
      icon: <Code size={24} />,
      detail: "Customize each node with specific parameters, from prompt engineering for LLMs to style controls for image generators. These settings give you granular control over how each AI model processes your data, allowing for truly personalized results."
    },
    {
      title: "Execute",
      description: "Set your workflow in motion and watch as each node processes and transforms the data in sequence.",
      icon: <CommandIcon size={24} />,
      detail: "Run your workflow with a single click and observe the AI agents collaborating in real-time. The system processes your inputs sequentially through each node, with each component building upon the previous outputs to create a cohesive result."
    }
  ];

  return (
    <div className="standard-container">
      <div className="text-center mb-16">
        <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-[rgba(255,255,255,0.05)] mb-6">
          <WorkflowIcon size={14} className="mr-2 text-white" />
          <span className="text-text-secondary text-sm">Intuitive Process</span>
        </div>
        <h2 className="section-title">How It Works</h2>
        <p className="section-description">
          XenoLabs transforms complex AI operations into a visual, intuitive workflow that anyone can master.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-12">
        {/* Interactive step display - optimized for performance */}
        <div className="bg-[rgba(255,255,255,0.02)] backdrop-blur-[10px] rounded-2xl border border-[rgba(255,255,255,0.05)] p-2 overflow-hidden transform-gpu">
          {/* Step navigation with proper event delegation */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
            {steps.map((step, index) => (
              <button
                key={index}
                className={`relative py-4 px-3 rounded-xl text-left transition-all duration-300 overflow-hidden transform-gpu ${
                  activeStep === index 
                    ? 'bg-[rgba(255,255,255,0.05)] shadow-glass' 
                    : 'hover:bg-[rgba(255,255,255,0.03)]'
                }`}
                onClick={() => setActiveStep(index)}
                aria-selected={activeStep === index}
                role="tab"
              >
                <div className="flex items-center">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center mr-3 transition-all duration-300 ${
                    activeStep === index 
                      ? 'bg-white text-primary-bg' 
                      : 'bg-[rgba(255,255,255,0.05)] text-white'
                  }`}>
                    {index + 1}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">{step.title}</h3>
                    <p className="text-xs text-text-secondary mt-1 hidden md:block">{step.description.split(' ').slice(0, 3).join(' ')}...</p>
                  </div>
                </div>
                {activeStep === index && (
                  <div className="absolute bottom-0 left-0 w-full h-1 bg-white/20"></div>
                )}
              </button>
            ))}
          </div>
          
          {/* Step content with efficient rendering */}
          <div className="bg-[rgba(255,255,255,0.03)] rounded-xl p-6 md:p-8 min-h-[400px]" role="tabpanel">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-8 items-center h-full">
              {/* Step information */}
              <div className="md:col-span-2 space-y-6">
                <div className="inline-flex items-center justify-center p-3 rounded-lg bg-[rgba(255,255,255,0.05)]">
                  {steps[activeStep].icon}
                </div>
                
                <h3 className="text-2xl md:text-3xl font-bold text-white">
                  {activeStep + 1}. {steps[activeStep].title}
                </h3>
                
                <p className="text-text-secondary leading-relaxed">
                  {steps[activeStep].description}
                </p>
                
                <div className="pt-4">
                  <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-4 border border-[rgba(255,255,255,0.05)]">
                    <p className="text-sm text-text-secondary leading-relaxed">
                      {steps[activeStep].detail}
                    </p>
                  </div>
                </div>
                
                <div className="pt-2 flex justify-between items-center">
                  <button 
                    onClick={() => setActiveStep(prev => (prev > 0 ? prev - 1 : steps.length - 1))}
                    className="text-text-secondary hover:text-white transition-colors p-2 transform-gpu"
                    aria-label="Previous step"
                  >
                    <ArrowRight size={20} className="rotate-180" />
                  </button>
                  
                  <div className="text-text-secondary text-sm">
                    Step {activeStep + 1} of {steps.length}
                  </div>
                  
                  <button 
                    onClick={() => setActiveStep(prev => (prev < steps.length - 1 ? prev + 1 : 0))}
                    className="text-text-secondary hover:text-white transition-colors p-2 transform-gpu"
                    aria-label="Next step"
                  >
                    <ArrowRight size={20} />
                  </button>
                </div>
              </div>
              
              {/* Visual representation with efficient rendering */}
              <div className="md:col-span-3 h-full">
                <div className="bg-[#1A1A1A] rounded-lg border border-[rgba(255,255,255,0.05)] h-full p-5 relative overflow-hidden content-visibility-auto">
                  {/* Step visualization - different for each step, using will-change and transform */}
                  <div className="absolute inset-0">
                    {activeStep === 0 && (
                      <div className="absolute inset-0 p-4 flex items-center justify-center">
                        <div className="relative w-full h-full">
                          {/* Design step - shows node being dragged onto canvas */}
                          <div className="absolute w-40 h-20 top-1/4 left-1/3 bg-[#1E1E1E] rounded-lg border border-white/10 shadow-lg animate-pulse-slow transform-gpu will-change-transform">
                            <div className="p-3 border-b border-white/5">
                              <div className="text-xs text-white">LLM Agent</div>
                            </div>
                          </div>
                          
                          <div className="absolute bottom-1/4 right-1/3 w-40 h-20 bg-[#1E1E1E] rounded-lg border border-white/10 shadow-lg opacity-40 transform-gpu">
                            <div className="p-3 border-b border-white/5">
                              <div className="text-xs text-white">Image Generator</div>
                            </div>
                          </div>
                          
                          <div className="absolute top-0 left-0 w-full h-full pointer-events-none" 
                            style={{
                              backgroundSize: '20px 20px',
                              backgroundImage: 'linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
                              backgroundPosition: 'center center'
                            }}>
                          </div>
                          
                          <div className="absolute bottom-4 right-4 bg-white/5 rounded-lg px-3 py-1 text-xs text-white/70">Canvas View</div>
                        </div>
                      </div>
                    )}
                    
                    {activeStep === 1 && (
                      <div className="absolute inset-0 p-4 flex items-center justify-center">
                        <div className="relative w-full h-full">
                          {/* Connect step - shows nodes being connected */}
                          <div className="absolute top-1/4 left-1/4 w-40 h-20 bg-[#1E1E1E] rounded-lg border border-white/10 shadow-lg transform-gpu">
                            <div className="p-3 border-b border-white/5">
                              <div className="text-xs text-white">Text Generator</div>
                            </div>
                            <div className="absolute right-0 top-1/2 -mr-1.5 w-3 h-3 rounded-full bg-white/30 border border-white/10"></div>
                          </div>
                          
                          <div className="absolute bottom-1/4 right-1/4 w-40 h-20 bg-[#1E1E1E] rounded-lg border border-white/10 shadow-lg transform-gpu">
                            <div className="p-3 border-b border-white/5">
                              <div className="text-xs text-white">Image Generator</div>
                            </div>
                            <div className="absolute left-0 top-1/2 -ml-1.5 w-3 h-3 rounded-full bg-white/30 border border-white/10"></div>
                          </div>
                          
                          {/* Connection line with optimized dash animation */}
                          <svg className="absolute inset-0 w-full h-full z-elevated">
                            <path
                              d="M 150,100 C 200,100 300,200 350,200"
                              stroke="rgba(255,255,255,0.5)"
                              strokeWidth="1.5"
                              strokeDasharray="5,5"
                              fill="none"
                              className="animate-dashOffset"
                            />
                          </svg>
                          
                          <div className="absolute top-0 left-0 w-full h-full pointer-events-none" 
                            style={{
                              backgroundSize: '20px 20px',
                              backgroundImage: 'linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
                              backgroundPosition: 'center center'
                            }}>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {activeStep === 2 && (
                      <div className="absolute inset-0 p-4 flex items-center justify-center">
                        <div className="bg-[#1E1E1E] rounded-lg border border-white/10 shadow-lg w-4/5 mx-auto overflow-hidden transform-gpu">
                          {/* Configure step - shows node settings */}
                          <div className="p-3 border-b border-white/5 flex justify-between items-center">
                            <div className="text-sm text-white">Configure Node: Image Generator</div>
                            <div className="text-white/50 text-xs">Settings</div>
                          </div>
                          <div className="p-4">
                            <div className="mb-4">
                              <div className="text-xs text-white/70 mb-1">Model Selection</div>
                              <div className="bg-white/5 rounded p-2 text-xs text-white">Stable Diffusion XL</div>
                            </div>
                            <div className="mb-4">
                              <div className="text-xs text-white/70 mb-1">Style Parameter</div>
                              <div className="bg-white/5 rounded p-2 text-xs text-white">Photorealistic, Detailed</div>
                            </div>
                            <div className="mb-4">
                              <div className="text-xs text-white/70 mb-1">Resolution</div>
                              <div className="bg-white/5 rounded p-2 text-xs text-white">1024 x 1024</div>
                            </div>
                            <div className="mb-4">
                              <div className="text-xs text-white/70 mb-1">Additional Settings</div>
                              <div className="space-y-2">
                                <div className="flex items-center">
                                  <div className="w-full bg-white/5 h-1 rounded-full">
                                    <div className="bg-white/50 h-1 rounded-full w-3/4"></div>
                                  </div>
                                  <span className="text-xs text-white/50 ml-2">75%</span>
                                </div>
                                <div className="flex items-center">
                                  <div className="w-full bg-white/5 h-1 rounded-full">
                                    <div className="bg-white/50 h-1 rounded-full w-1/2"></div>
                                  </div>
                                  <span className="text-xs text-white/50 ml-2">50%</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {activeStep === 3 && (
                      <div className="absolute inset-0 p-4 flex items-center justify-center">
                        <div className="relative w-full h-full">
                          {/* Execute step - shows workflow running with optimized animations */}
                          <div className="absolute top-1/4 left-1/4 w-40 h-20 bg-[#1E1E1E] rounded-lg border border-white/10 shadow-lg transform-gpu">
                            <div className="p-3 border-b border-white/5 flex items-center">
                              <div className="w-2 h-2 rounded-full bg-green-400 mr-2"></div>
                              <div className="text-xs text-white">Text Generator</div>
                            </div>
                            <div className="p-2">
                              <div className="h-1.5 bg-green-400/20 rounded-full w-full">
                                <div className="h-1.5 bg-green-400 rounded-full w-full"></div>
                              </div>
                            </div>
                            <div className="absolute right-0 top-1/2 -mr-1.5 w-3 h-3 rounded-full bg-green-400 border border-white/10"></div>
                          </div>
                          
                          <div className="absolute bottom-1/4 right-1/4 w-40 h-20 bg-[#1E1E1E] rounded-lg border border-white/10 shadow-lg transform-gpu">
                            <div className="p-3 border-b border-white/5 flex items-center">
                              <div className="w-2 h-2 rounded-full bg-blue-400 mr-2"></div>
                              <div className="text-xs text-white">Image Generator</div>
                            </div>
                            <div className="p-2">
                              <div className="h-1.5 bg-blue-400/20 rounded-full w-full">
                                <div className="h-1.5 bg-blue-400 rounded-full w-3/4 origin-left" style={{ animation: 'grow 1.5s ease-in-out infinite' }}></div>
                              </div>
                            </div>
                            <div className="absolute left-0 top-1/2 -ml-1.5 w-3 h-3 rounded-full bg-blue-400 border border-white/10"></div>
                          </div>
                          
                          {/* Connection line with flowing animation */}
                          <svg className="absolute inset-0 w-full h-full z-elevated">
                            <path
                              d="M 150,100 C 200,100 300,200 350,200"
                              stroke="rgba(255,255,255,0.2)"
                              strokeWidth="3"
                              fill="none"
                            />
                            <path
                              d="M 150,100 C 200,100 300,200 350,200"
                              stroke="rgba(100,255,100,0.6)"
                              strokeWidth="1.5"
                              strokeDasharray="5,15"
                              fill="none"
                              className="animate-flowDash"
                            />
                          </svg>
                          
                          <div className="absolute top-0 left-0 w-full h-full pointer-events-none" 
                            style={{
                              backgroundSize: '20px 20px',
                              backgroundImage: 'linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
                              backgroundPosition: 'center center'
                            }}>
                          </div>
                          
                          {/* Processing indicator */}
                          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-[#1E1E1E]/90 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/10 text-white/80 text-sm flex items-center shadow-lg transform-gpu">
                            <div className="w-2 h-2 rounded-full bg-blue-400 mr-2 animate-pulse"></div>
                            Processing workflow...
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Bottom CTA */}
        <div className="bg-[rgba(255,255,255,0.03)] backdrop-blur-[10px] border border-[rgba(255,255,255,0.05)] p-6 rounded-xl text-center">
          <p className="text-text-secondary mb-4">
            Ready to experience the simplicity and power of visual AI programming?
          </p>
          <button className="bg-white text-primary-bg px-6 py-2 rounded-lg transition-all duration-300 transform-gpu hover:bg-white/90 hover:scale-[1.02]">
            Start Creating <ChevronRight size={16} className="inline ml-1" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Workflow;