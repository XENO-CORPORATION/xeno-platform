import React from 'react';
import GenerationSection from './sections/GenerationSection';

const BentoShowcase: React.FC = () => {
  return (
    <div className="bg-[#08080a]">
      {/* Generation Section */}
      <GenerationSection />
      
      {/* More sections will be added here */}
      {/* <EnhanceSection /> */}
      {/* <ChatSection /> */}
      {/* <StudiosSection /> */}
      {/* <OfficeSection /> */}
      {/* <ToolsSection /> */}
      {/* <CloudOSSection /> */}
    </div>
  );
};

export default BentoShowcase;
