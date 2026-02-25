import React from 'react';
import { Layers, GitBranch, Sparkles } from 'lucide-react';
import GlassContainer from '../ui/GlassContainer';

const About: React.FC = () => {
  const benefits = [
    {
      title: "All-in-One Platform",
      description: "Access all necessary AI-powered art generation tools in a single, integrated workspace, reducing friction and enhancing productivity.",
      icon: <Layers size={32} />,
      gradient: "from-white/10 to-white/5"
    },
    {
      title: "Dynamic & Intelligent Workflows",
      description: "The modular, agent-based system ensures that each component communicates effectively, tailoring outputs to each AI model.",
      icon: <GitBranch size={32} />,
      gradient: "from-white/10 to-white/5"
    },
    {
      title: "Empowerment Through Experimentation",
      description: "Encourages users to explore and innovate, making it ideal for both professionals and passionate creators seeking to push creative boundaries.",
      icon: <Sparkles size={32} />,
      gradient: "from-white/10 to-white/5"
    }
  ];

  return (
    <div className="standard-container">
      <div className="text-center mb-16">
        <h2 className="section-title">Why XenoStudio?</h2>
        <p className="section-description">
          XenoStudio stands out as a game-changer for creative professionals due to its unique features and benefits.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {benefits.map((benefit, index) => (
          <GlassContainer 
            key={index} 
            className="text-center p-6 progressive-load"
            hoverEffect={true}
          >
            <div className="inline-flex items-center justify-center p-4 rounded-full mb-6 relative">
              <div 
                className={`absolute inset-0 rounded-full bg-gradient-to-r ${benefit.gradient} opacity-20 animate-pulse-slow transform-gpu`}
                style={{ animationDuration: '3s' }}
              ></div>
              <div className="relative z-elevated text-white">{benefit.icon}</div>
            </div>
            <h3 className="text-xl font-semibold mb-3 text-white">{benefit.title}</h3>
            <p className="text-text-secondary leading-relaxed text-sm">{benefit.description}</p>
          </GlassContainer>
        ))}
      </div>
    </div>
  );
};

export default About;