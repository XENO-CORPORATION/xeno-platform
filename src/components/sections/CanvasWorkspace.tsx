import React from 'react';
import NodeEditor from '../canvas/NodeEditor';

const CanvasWorkspace: React.FC = () => {
  return (
    <div className="standard-container">
      <h2 className="section-title text-center">Interactive Canvas Workspace</h2>
      <p className="section-description text-center mb-10">
        Experience the power of XenoStudio through our intuitive node-based editor. Create, connect, and automate your AI workflow with drag-and-drop simplicity.
      </p>
      
      {/* Canvas Container - Optimized for rendering performance */}
      <div className="w-full h-[600px] rounded-2xl overflow-hidden relative border border-[rgba(255,255,255,0.1)] shadow-glass transform-gpu content-visibility-auto">
        {/* Background gradient and subtle grid */}
        <div className="absolute inset-0 bg-primary-bg z-0">
          <div className="absolute inset-0 z-0" 
            style={{
              backgroundSize: '24px 24px',
              backgroundImage: 'linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
              backgroundPosition: 'center center'
            }}
          />
        </div>
        
        {/* The NodeEditor component - taking full space */}
        <NodeEditor className="w-full h-full z-elevated relative" />
      </div>
      
      {/* Canvas explanation */}
      <div className="mt-8 px-6 py-6 bg-[rgba(255,255,255,0.05)] backdrop-blur-[10px] border border-[rgba(255,255,255,0.1)] rounded-2xl shadow-glass">
        <p className="text-text-secondary text-center">
          Connect AI components by dragging from output pins to input pins. Add new nodes using the menu at the bottom of the canvas.
          Each node processes data and passes results to connected nodes, creating powerful AI workflows.
        </p>
      </div>
    </div>
  );
};

export default CanvasWorkspace;