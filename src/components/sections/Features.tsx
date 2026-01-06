import React from 'react';
import { BrainCircuit, Image, Video, Layers, GitBranch, Sparkles } from 'lucide-react';
import GlassContainer from '../ui/GlassContainer';

const Features: React.FC = () => {
  const features = [
    {
      title: "LLM Agent Nodes",
      icon: <BrainCircuit size={24} />,
      description: "Utilize various language models to generate or refine text prompts, serving as the foundation for creative input.",
      color: "from-white/10 to-white/5",
      glow: "white"
    },
    {
      title: "Image Generation Nodes",
      icon: <Image size={24} />,
      description: "Transform text into high-quality images using advanced models such as Stable Diffusion, Flux, or Recraft.",
      color: "from-white/10 to-white/5",
      glow: "white"
    },
    {
      title: "Video Generation Nodes",
      icon: <Video size={24} />,
      description: "Convert images into dynamic video content, ensuring alignment with the user's creative vision.",
      color: "from-white/10 to-white/5",
      glow: "white"
    },
    {
      title: "Canvas Workspace",
      icon: <Layers size={24} />,
      description: "A customizable environment where users can drag and drop block nodes to create sophisticated workflows.",
      color: "from-white/10 to-white/5",
      glow: "white"
    },
    {
      title: "Agent Collaboration",
      icon: <GitBranch size={24} />,
      description: "Intelligent agents that communicate and adapt based on their connections, optimizing output for each AI model.",
      color: "from-white/10 to-white/5",
      glow: "white"
    },
    {
      title: "Intelligent Execution",
      icon: <Sparkles size={24} />,
      description: "Dynamic interaction ensures that each step builds on the previous one, creating a seamless creative journey.",
      color: "from-white/10 to-white/5",
      glow: "white"
    }
  ];

  return (
    <div className="standard-container">
      <div className="text-center mb-16">
        <h2 className="section-title">Key Components</h2>
        <p className="section-description">
          XenoLabs provides a unified workspace that consolidates essential AI generation tools in one powerful platform.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
        {features.map((feature, index) => (
          <GlassContainer 
            key={index}
            className="flex flex-col h-full p-6"
            hoverEffect={true}
          >
            <div 
              className={`p-3 rounded-lg bg-gradient-to-br ${feature.color} w-fit mb-5 relative overflow-hidden transform-gpu`}
              style={{
                boxShadow: `0 0 15px rgba(255, 255, 255, 0.1)`
              }}
            >
              <div className="relative z-elevated text-white">{feature.icon}</div>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer transform-gpu"></div>
            </div>
            <h3 className="text-xl font-semibold mb-3 text-white">{feature.title}</h3>
            <p className="text-text-secondary leading-relaxed text-sm">{feature.description}</p>
          </GlassContainer>
        ))}
      </div>
    </div>
  );
};

export default Features;